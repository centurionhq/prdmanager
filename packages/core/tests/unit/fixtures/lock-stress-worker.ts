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
      // Two margins, both needed (WO-207 finding 2):
      // - `staleAfterMs` over `heartbeatMs`: a held lock is only "stale" once it has missed a heartbeat by
      //   that much. Equal values (an earlier 5s/5s) meant a single scheduling delay made a still-live
      //   holder's lock look abandoned and get broken out from under it — a genuine mutual-exclusion
      //   violation caught by the `wx` marker, not a flaky assertion.
      // - `timeoutMs` (how long a *waiter* retries before giving up) over `staleAfterMs`: with the earlier
      //   15s/30s pairing a waiter always gave up *before* a truly stuck holder could ever be reclaimed,
      //   so every waiter hard-failed with "another process holds the lock" instead of recovering — on a
      //   2-vCPU CI runner, 6 contending processes can genuinely starve the current holder's event loop for
      //   several seconds without anything being wrong. `timeoutMs` now gives multiple eviction cycles of
      //   headroom over `staleAfterMs` so a waiter can actually benefit from the recovery it pays for.
      { timeoutMs: 40_000, staleAfterMs: 8_000, heartbeatMs: 250 },
    );
  }
}

main().catch((err: unknown) => {
  appendFileSync(violationsPath, `worker ${workerId} crashed: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
