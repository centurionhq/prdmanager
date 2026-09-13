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
      { timeoutMs: 15_000, staleAfterMs: 5_000 },
    );
  }
}

main().catch((err: unknown) => {
  appendFileSync(violationsPath, `worker ${workerId} crashed: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
