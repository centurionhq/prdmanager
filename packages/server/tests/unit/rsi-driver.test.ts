import { describe, expect, test } from 'vitest';
import {
  computeDelayMs,
  defaultState,
  FAILURE_THRESHOLD,
  IDLE_INTERVAL_MS,
  isPaused,
  MIN_INTERVAL_MS,
  nextState,
  parseCycleOutcome,
  readState,
  runCycleOnce,
  writeState,
} from '../../../../scripts/rsi/driver-lib.mjs';

// WO-588 / SDD-057: `driver.mjs` orchestrates a real `claude -p` invocation forever, far too expensive to
// exercise here. These tests cover the pure guard/circuit-breaker/pacing/parsing logic in `driver-lib.mjs`
// against in-memory fakes, never a real filesystem or `claude` process.

function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: (p: string) => files.has(p),
    readFileSync: (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    writeFileSync: (p: string, content: string) => {
      files.set(p, content);
    },
    renameSync: (from: string, to: string) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, content);
    },
    mkdirSync: () => undefined,
  };
}

describe('parseCycleOutcome', () => {
  test('extracts a well-formed implemented outcome with backlog remaining', () => {
    const stdout = `some agent chatter\n<<<RSI_CYCLE_OUTCOME>>>\n${JSON.stringify({ outcome: 'implemented', workOrderId: 'WO-1', backlogRemaining: true })}\n<<<END>>>\ntrailing`;
    expect(parseCycleOutcome(stdout)).toEqual({ success: true, backlogRemaining: true, rollbackFailed: false, raw: { outcome: 'implemented', workOrderId: 'WO-1', backlogRemaining: true } });
  });

  test('treats an idle outcome (nothing to do) as success with no backlog', () => {
    const stdout = `<<<RSI_CYCLE_OUTCOME>>>${JSON.stringify({ outcome: 'idle' })}<<<END>>>`;
    expect(parseCycleOutcome(stdout)).toEqual({ success: true, backlogRemaining: false, rollbackFailed: false, raw: { outcome: 'idle' } });
  });

  test('treats a failed outcome with rollbackFailed flagged', () => {
    const stdout = `<<<RSI_CYCLE_OUTCOME>>>${JSON.stringify({ outcome: 'failed', rollbackFailed: true })}<<<END>>>`;
    const result = parseCycleOutcome(stdout);
    expect(result.success).toBe(false);
    expect(result.rollbackFailed).toBe(true);
  });

  test('is a failure when no marker block is present at all', () => {
    expect(parseCycleOutcome('the agent forgot to report anything')).toEqual({ success: false, backlogRemaining: false, rollbackFailed: false });
  });

  test('is a failure when the marker block contains malformed JSON', () => {
    const stdout = '<<<RSI_CYCLE_OUTCOME>>>not json<<<END>>>';
    expect(parseCycleOutcome(stdout)).toEqual({ success: false, backlogRemaining: false, rollbackFailed: false });
  });
});

describe('nextState', () => {
  test('a successful cycle resets the failure counter and clears any pause', () => {
    const state = { consecutiveFailures: 2, pausedReason: null, lastCycleAt: null };
    const outcome = { success: true, backlogRemaining: false, rollbackFailed: false };
    expect(nextState(state, outcome, '2026-01-01T00:00:00.000Z')).toEqual({ consecutiveFailures: 0, pausedReason: null, lastCycleAt: '2026-01-01T00:00:00.000Z' });
  });

  test('increments the failure counter without pausing before the threshold', () => {
    const state = defaultState();
    const outcome = { success: false, backlogRemaining: false, rollbackFailed: false };
    const result = nextState(state, outcome, 'now');
    expect(result.consecutiveFailures).toBe(1);
    expect(result.pausedReason).toBeNull();
  });

  test(`pauses once consecutive failures reach FAILURE_THRESHOLD (${FAILURE_THRESHOLD})`, () => {
    let state = defaultState();
    const outcome = { success: false, backlogRemaining: false, rollbackFailed: false };
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) state = nextState(state, outcome, 'now');
    expect(state.consecutiveFailures).toBe(FAILURE_THRESHOLD);
    expect(state.pausedReason).not.toBeNull();
  });

  test('a failed rollback pauses immediately regardless of the failure counter', () => {
    const state = defaultState();
    const outcome = { success: false, backlogRemaining: false, rollbackFailed: true };
    const result = nextState(state, outcome, 'now');
    expect(result.pausedReason).toMatch(/rollback failed/);
  });
});

describe('computeDelayMs', () => {
  test('uses the minimum interval floor when backlog remains', () => {
    expect(computeDelayMs({ success: true, backlogRemaining: true, rollbackFailed: false })).toBe(MIN_INTERVAL_MS);
  });

  test('uses the longer idle interval when there is no backlog', () => {
    expect(computeDelayMs({ success: true, backlogRemaining: false, rollbackFailed: false })).toBe(IDLE_INTERVAL_MS);
  });
});

describe('read/write/isPaused state helpers', () => {
  test('readState returns the default state when no file exists yet', () => {
    const fsDeps = memoryFs();
    expect(readState('/state.json', fsDeps)).toEqual(defaultState());
  });

  test('writeState then readState round-trips', () => {
    const fsDeps = memoryFs();
    const state = { consecutiveFailures: 1, pausedReason: null, lastCycleAt: 'now' };
    writeState('/state.json', state, fsDeps);
    expect(readState('/state.json', fsDeps)).toEqual(state);
  });

  test('readState falls back to defaults when the file is corrupt, instead of throwing', () => {
    const fsDeps = memoryFs({ '/state.json': 'not json' });
    expect(readState('/state.json', fsDeps)).toEqual(defaultState());
  });

  test('readState falls back to defaults when consecutiveFailures is wrong-shaped (would defeat the threshold check via NaN)', () => {
    const fsDeps = memoryFs({ '/state.json': JSON.stringify({ consecutiveFailures: '3', pausedReason: null, lastCycleAt: 'x' }) });
    expect(readState('/state.json', fsDeps)).toEqual(defaultState());
  });

  test('readState falls back to defaults when pausedReason is wrong-shaped', () => {
    const fsDeps = memoryFs({ '/state.json': JSON.stringify({ consecutiveFailures: 1, pausedReason: 42, lastCycleAt: 'x' }) });
    expect(readState('/state.json', fsDeps)).toEqual(defaultState());
  });

  test('writeState writes to a temp path and renames into place, never leaving the target path partially written', () => {
    const fsDeps = memoryFs();
    const state = { consecutiveFailures: 1, pausedReason: null, lastCycleAt: 'now' };
    writeState('/state.json', state, fsDeps);
    expect([...fsDeps.files.keys()]).toEqual(['/state.json']);
    expect(readState('/state.json', fsDeps)).toEqual(state);
  });

  test('isPaused reflects whether the sentinel file exists', () => {
    const fsDeps = memoryFs({ '/PAUSE': '' });
    expect(isPaused('/PAUSE', fsDeps)).toBe(true);
    expect(isPaused('/missing', fsDeps)).toBe(false);
  });
});

describe('runCycleOnce', () => {
  test('skips invoking claude at all when the PAUSE sentinel is present', async () => {
    const fsDeps = memoryFs({ '/PAUSE': '' });
    let called = false;
    const result = await runCycleOnce({
      statePath: '/state.json',
      pausePath: '/PAUSE',
      runClaude: async () => {
        called = true;
        return { stdout: '' };
      },
      fsDeps,
    });
    expect(called).toBe(false);
    expect(result).toEqual({ ran: false, reason: 'PAUSE sentinel present', state: defaultState(), delayMs: null });
  });

  test('skips invoking claude when the stored state already carries a pausedReason', async () => {
    const fsDeps = memoryFs({ '/state.json': JSON.stringify({ consecutiveFailures: 3, pausedReason: 'too many failures', lastCycleAt: 'x' }) });
    let called = false;
    const result = await runCycleOnce({
      statePath: '/state.json',
      pausePath: '/PAUSE',
      runClaude: async () => {
        called = true;
        return { stdout: '' };
      },
      fsDeps,
    });
    expect(called).toBe(false);
    expect(result.reason).toBe('too many failures');
  });

  test('runs a cycle, persists the updated state, and returns the next delay', async () => {
    const fsDeps = memoryFs();
    const stdout = `<<<RSI_CYCLE_OUTCOME>>>${JSON.stringify({ outcome: 'implemented', backlogRemaining: true })}<<<END>>>`;
    const result = await runCycleOnce({
      statePath: '/state.json',
      pausePath: '/PAUSE',
      runClaude: async () => ({ stdout }),
      now: () => '2026-01-01T00:00:00.000Z',
      fsDeps,
    });
    expect(result.ran).toBe(true);
    expect(result.delayMs).toBe(MIN_INTERVAL_MS);
    expect(readState('/state.json', fsDeps)).toEqual({ consecutiveFailures: 0, pausedReason: null, lastCycleAt: '2026-01-01T00:00:00.000Z' });
  });

  test('degrades to a failure outcome (and still persists state) when runClaude rejects, instead of crashing', async () => {
    const fsDeps = memoryFs();
    const result = await runCycleOnce({
      statePath: '/state.json',
      pausePath: '/PAUSE',
      runClaude: async () => {
        throw new Error('spawn claude ENOENT');
      },
      now: () => '2026-01-01T00:00:00.000Z',
      fsDeps,
    });
    expect(result.ran).toBe(true);
    expect(result.outcome?.success).toBe(false);
    expect(result.state.consecutiveFailures).toBe(1);
    // Must actually persist -- an uncaught rejection here would skip writeState, and the failure would
    // never count toward the circuit breaker's threshold.
    expect(readState('/state.json', fsDeps)).toEqual(result.state);
  });

  test('a run of consecutive runClaude rejections still trips the circuit breaker', async () => {
    const fsDeps = memoryFs();
    let last;
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
      last = await runCycleOnce({
        statePath: '/state.json',
        pausePath: '/PAUSE',
        runClaude: async () => {
          throw new Error('spawn claude ENOENT');
        },
        fsDeps,
      });
    }
    expect(last?.state.pausedReason).not.toBeNull();
  });
});
