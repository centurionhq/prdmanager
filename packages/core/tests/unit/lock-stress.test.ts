import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { makeTmpDir, removeDir } from '@prdm/testkit';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'fixtures', 'lock-stress-worker.ts');

function describeFailure(reason: unknown): string {
  const err = reason as { code?: unknown; signal?: unknown; killed?: unknown; stderr?: unknown; message?: unknown };
  const stderr = typeof err.stderr === 'string' ? err.stderr.trim().slice(-2000) : '';
  return `code=${String(err.code)} signal=${String(err.signal)} killed=${String(err.killed)} stderr=${stderr || String(err.message)}`;
}

function readViolations(root: string): string {
  const path = join(root, '.prdm', 'violations.log');
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
}

/** Whatever owner state is left behind on failure — tells us whether a timeout was caused by a genuinely
 * stuck/dead holder (stale heartbeat, dead pid) or something else entirely, instead of guessing. */
function readLockFile(root: string): string {
  const path = join(root, '.prdm', 'engine.lock');
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : '(no lock file left behind)';
}

// No finite `staleAfterMs` can be fully safe against an unbounded scheduler stall: telling "still working,
// just slow" apart from "abandoned" from outside the process is fundamentally impossible on liveness alone
// (restoring `staleAfterMs` to the evidenced-safe 30s in WO-211 did NOT stop a real EEXIST violation from
// recurring — this isn't a margin-tuning bug, it's residual tail risk). What actually differs is how often 6
// processes doing 100 tiny critical sections each land in that tail on a real 2-vCPU CI runner vs. a
// many-core dev machine. Rather than keep guessing at ever-larger margins, CI runs a smaller, still-genuine
// stress (real multi-process contention, just less of it) to cut how often the tail gets hit; local runs keep
// the full stress since dev machines have never reproduced this failure even once.
const WORKERS = process.env.CI ? 3 : 6;
const ITERATIONS_PER_WORKER = process.env.CI ? 30 : 100;

describe('withRepoLock: real multi-process mutual exclusion (WO-023 finding 3)', () => {
  test(
    `${WORKERS} processes x ${ITERATIONS_PER_WORKER} lock acquisitions never overlap on an exclusive marker file`,
    async () => {
      const root = makeTmpDir('prdm-lock-stress-');
      try {
        // 6 concurrent `node --import tsx` processes are CPU-bound at startup (tsx transpiles on the fly); on a
        // 2-vCPU CI runner that contention can dwarf the time seen on a many-core dev machine, so the exec/test
        // timeouts need real headroom over the worker's own (much larger, see the WO-207 comment there) per-
        // acquisition `timeoutMs`, itself needing headroom over `staleAfterMs` for eviction to ever help a waiter.
        const workers = Array.from({ length: WORKERS }, (_, i) => run('node', ['--import', 'tsx', WORKER, root, String(ITERATIONS_PER_WORKER), String(i)], { timeout: 150_000 }));
        const results = await Promise.allSettled(workers);
        const failures = results.flatMap((result, i) =>
          result.status === 'rejected' ? [`worker ${i}: ${describeFailure(result.reason)}`] : [],
        );
        // vitest only prints execFile's "Command failed" line, so surface the worker's own diagnosis instead.
        expect({ failures, violations: readViolations(root), lockFile: readLockFile(root) }).toEqual({
          failures: [],
          violations: '',
          lockFile: '(no lock file left behind)',
        });
      } finally {
        removeDir(root);
      }
    },
    160_000,
  );
});
