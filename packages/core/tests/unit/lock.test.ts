import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { LOCK_PATH, withRepoLock } from '../../src/util/lock.js';
import { makeTmpDir, removeDir } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withRepoLock', () => {
  test('serializes concurrent critical sections and releases the lock', async () => {
    root = makeTmpDir();
    const events: string[] = [];
    const section = (name: string) => async () => {
      events.push(`${name}:start`);
      await sleep(50);
      events.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([withRepoLock(root, section('a')), withRepoLock(root, section('b'))]);
    expect(results.sort()).toEqual(['a', 'b']);
    expect(events).toHaveLength(4);
    expect(events[1]?.endsWith(':end')).toBe(true);
    expect(events[0]?.split(':')[0]).toBe(events[1]?.split(':')[0]);
    expect(existsSync(join(root, LOCK_PATH))).toBe(false);
  });

  test('releases the lock when the section throws', async () => {
    root = makeTmpDir();
    await expect(withRepoLock(root, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(existsSync(join(root, LOCK_PATH))).toBe(false);
  });

  test('breaks a stale lock left by a dead process', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    writeFileSync(join(root, LOCK_PATH), JSON.stringify({ pid: 2_147_483_000, createdAt: new Date().toISOString() }));
    expect(await withRepoLock(root, async () => 'ok', { timeoutMs: 1000 })).toBe('ok');
  });

  test('times out while a live process holds the lock', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    writeFileSync(join(root, LOCK_PATH), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    await expect(withRepoLock(root, async () => 'never', { timeoutMs: 300 })).rejects.toThrow(/another prdm process/);
  });

  test('does not steal a live owner even with an old createdAt, as long as its heartbeat is recent', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(root, LOCK_PATH),
      JSON.stringify({ token: 'other', pid: process.pid, host: hostname(), createdAt: old, heartbeatAt: new Date().toISOString() }),
    );
    await expect(withRepoLock(root, async () => 'never', { timeoutMs: 300 })).rejects.toThrow(/another prdm process/);
    // the foreign lock must still be there: it was never broken
    expect(existsSync(join(root, LOCK_PATH))).toBe(true);
  });

  test('steals a lock whose owner pid is dead, regardless of its heartbeat freshness', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    writeFileSync(
      join(root, LOCK_PATH),
      JSON.stringify({ token: 'other', pid: 2_147_483_000, host: hostname(), createdAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }),
    );
    expect(await withRepoLock(root, async () => 'ok', { timeoutMs: 1000 })).toBe('ok');
  });

  test('does not remove a lock whose token no longer matches ours on release', async () => {
    root = makeTmpDir();
    await withRepoLock(root, async () => {
      // Simulate another process breaking our (apparently stale) lock and acquiring its own while we still think we hold it.
      const foreign = { token: 'foreign-token', pid: process.pid, host: 'some-other-host', createdAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
      mkdirSync(join(root, '.prdm'), { recursive: true });
      writeFileSync(join(root, LOCK_PATH), JSON.stringify(foreign));
    });
    expect(JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8')).token).toBe('foreign-token');
  });

  test('an unparsable/empty lock is held until its file mtime exceeds staleAfterMs, then becomes stealable (WO-023 finding 3)', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    writeFileSync(join(root, LOCK_PATH), ''); // empty: unparsable as JSON
    const recentMtime = new Date();
    utimesSync(join(root, LOCK_PATH), recentMtime, recentMtime);
    await expect(withRepoLock(root, async () => 'never', { timeoutMs: 200, staleAfterMs: 100_000 })).rejects.toThrow(/another prdm process/);
    expect(existsSync(join(root, LOCK_PATH))).toBe(true); // too fresh (by mtime) to break

    const oldMtime = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(join(root, LOCK_PATH), oldMtime, oldMtime);
    expect(await withRepoLock(root, async () => 'ok', { timeoutMs: 1000, staleAfterMs: 100 })).toBe('ok');
  });

  test('a far-future heartbeat is never trusted; staleness falls back to the file mtime instead (WO-023 finding 3)', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    // pid must be alive (this process) so the dead-pid short-circuit doesn't mask what's under test: the far-future heartbeat itself must not be trusted.
    writeFileSync(join(root, LOCK_PATH), JSON.stringify({ token: 'spoofed', pid: process.pid, host: hostname(), createdAt: new Date().toISOString(), heartbeatAt: farFuture }));
    const oldMtime = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(join(root, LOCK_PATH), oldMtime, oldMtime);

    expect(await withRepoLock(root, async () => 'ok', { timeoutMs: 1000, staleAfterMs: 100 })).toBe('ok');
  });

  test('refreshes the heartbeat on disk while the section runs', async () => {
    root = makeTmpDir();
    const seen: string[] = [];
    await withRepoLock(
      root,
      async () => {
        // Sleeps are wide relative to heartbeatMs so the assertion holds even under CI scheduler jitter of
        // tens of milliseconds (a 20ms sleep left only one heartbeat write observable on a contended runner).
        await sleep(100);
        seen.push(JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8')).heartbeatAt);
        await sleep(100);
        seen.push(JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8')).heartbeatAt);
        await sleep(100);
        seen.push(JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8')).heartbeatAt);
      },
      { heartbeatMs: 5 },
    );
    expect(new Set(seen).size).toBeGreaterThan(1);
  });

  test('a heartbeat still in flight at release never resurrects the lock file (WO-207)', async () => {
    root = makeTmpDir();
    // A 1ms heartbeat against 0-2ms critical sections makes an in-flight heartbeat at release time near-certain
    // across 300 sequential acquisitions; before the fix one of them renamed the lock back after release, so the
    // next acquisition in this same process timed out on an orphaned lock owned by a live pid.
    for (let i = 0; i < 300; i += 1) {
      await withRepoLock(root, () => sleep(i % 3), { heartbeatMs: 1, staleAfterMs: 30_000, timeoutMs: 2_000 });
      expect(existsSync(join(root, LOCK_PATH))).toBe(false);
    }
  });
});
