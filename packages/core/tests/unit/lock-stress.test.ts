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

const WORKERS = 6;
const ITERATIONS_PER_WORKER = 100;

describe('withRepoLock: real multi-process mutual exclusion (WO-023 finding 3)', () => {
  test(
    `${WORKERS} processes x ${ITERATIONS_PER_WORKER} lock acquisitions never overlap on an exclusive marker file`,
    async () => {
      const root = makeTmpDir('prdm-lock-stress-');
      try {
        // 6 concurrent `node --import tsx` processes are CPU-bound at startup (tsx transpiles on the fly); on a
        // 2-vCPU CI runner that contention can dwarf the time seen on a many-core dev machine, so both timeouts
        // here need real headroom over what's sufficient locally.
        const workers = Array.from({ length: WORKERS }, (_, i) => run('node', ['--import', 'tsx', WORKER, root, String(ITERATIONS_PER_WORKER), String(i)], { timeout: 45_000 }));
        const results = await Promise.allSettled(workers);
        const failures = results.flatMap((result, i) =>
          result.status === 'rejected' ? [`worker ${i}: ${describeFailure(result.reason)}`] : [],
        );
        // vitest only prints execFile's "Command failed" line, so surface the worker's own diagnosis instead.
        expect({ failures, violations: readViolations(root) }).toEqual({ failures: [], violations: '' });
      } finally {
        removeDir(root);
      }
    },
    50_000,
  );
});
