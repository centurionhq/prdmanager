/**
 * Standalone worker process for the `withRepoLock` multi-process mutual-exclusion stress test
 * (packages/core/tests/unit/lock-stress.test.ts, WO-023 finding 3). Not a test file itself.
 *
 * Usage: node --import tsx lock-stress-worker.ts <root> <iterations> <workerId>
 *
 * Each iteration acquires the repo lock and, inside the critical section, creates an exclusive marker file with
 * `wx` (fails hard with EEXIST if another worker's critical section is concurrently active), holds it briefly,
 * then removes it. A real violation crashes the worker (non-zero exit) so the parent test fails.
 */
import { appendFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withRepoLock } from '../../../src/util/lock.js';

const [, , rootArg, iterationsRaw, workerIdArg] = process.argv;
if (!rootArg || !iterationsRaw || !workerIdArg) throw new Error('usage: lock-stress-worker.ts <root> <iterations> <workerId>');
const root: string = rootArg;
const workerId: string = workerIdArg;
const iterations = Number(iterationsRaw);

const prdmDir = join(root, '.prdm');
const markerPath = join(prdmDir, 'exclusive-marker');
const violationsPath = join(prdmDir, 'violations.log');

async function main(): Promise<void> {
  mkdirSync(prdmDir, { recursive: true });
  for (let i = 0; i < iterations; i += 1) {
    await withRepoLock(
      root,
      async () => {
        // `wx` is the actual exclusivity assertion: if another worker's critical section is concurrently open,
        // this throws EEXIST and the whole worker crashes (caught below), failing the test.
        writeFileSync(markerPath, workerId, { flag: 'wx' });
        await new Promise((resolve) => setTimeout(resolve, 1));
        unlinkSync(markerPath);
      },
      // Two margins, both needed, and both empirically evidenced (not just theorized) on this repo's CI
      // runner across four separate failures:
      // - `staleAfterMs` over `heartbeatMs`: a held lock is only "stale" once it has missed a heartbeat by
      //   that much. Equal values (an earlier 5s/5s) meant a single scheduling delay made a still-live
      //   holder's lock look abandoned and get broken out from under it — a genuine mutual-exclusion
      //   violation caught by the `wx` marker (EEXIST), not a flaky assertion. 30s was then verified safe
      //   across many CI runs with zero such violations. WO-209 tried shrinking it to 8s to let waiters
      //   recover sooner — that reproduced the *exact same* EEXIST violation on the very next CI run: real
      //   scheduling delays under 6-way contention on a 2-vCPU runner can exceed 8s, so 30s is the actual
      //   evidenced floor, not just a guess, and is restored here.
      // - `timeoutMs` (how long a *waiter* retries before giving up) over `staleAfterMs`: with an earlier
      //   15s/30s pairing a waiter always gave up *before* a truly stuck holder could ever be reclaimed, so
      //   every waiter hard-failed with "another process holds the lock" instead of recovering. This part
      //   of WO-209's fix was correct and stays: `timeoutMs` gives multiple eviction cycles of headroom
      //   over `staleAfterMs` so a waiter can actually benefit from the recovery it pays for, without
      //   needing `staleAfterMs` itself to shrink.
      { timeoutMs: 90_000, staleAfterMs: 30_000, heartbeatMs: 500 },
    );
  }
}

main().catch((err: unknown) => {
  appendFileSync(violationsPath, `worker ${workerId} crashed: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
