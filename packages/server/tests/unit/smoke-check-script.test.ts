import { describe, expect, test, vi } from 'vitest';
import { smokeCheck } from '../../scripts/smoke-check.mjs';

// WO-586 / SDD-057: `smokeCheck` must retry with backoff and never throw -- these tests use a fake
// `fetchImpl`/`sleep` so no real network call or real delay ever happens.

function fakeSleep() {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
  };
  return { sleep, calls };
}

describe('smokeCheck', () => {
  test('succeeds on the first attempt when the health endpoint responds ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const { sleep, calls } = fakeSleep();

    const result = await smokeCheck({ fetchImpl, sleep, attempts: 3 });

    expect(result).toEqual({ ok: true, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4601/api/health');
    expect(calls).toEqual([]);
  });

  test('retries with increasing backoff and succeeds once the endpoint recovers', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true });
    const { sleep, calls } = fakeSleep();

    const result = await smokeCheck({ fetchImpl, sleep, attempts: 5, delayMs: 100 });

    expect(result).toEqual({ ok: true, attempts: 3 });
    expect(calls).toEqual([100, 200]);
  });

  test('reports failure with the last error after exhausting all attempts, without sleeping after the last one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { sleep, calls } = fakeSleep();

    const result = await smokeCheck({ fetchImpl, sleep, attempts: 2, delayMs: 50 });

    expect(result).toEqual({ ok: false, attempts: 2, lastError: 'HTTP 500' });
    expect(calls).toEqual([50]);
  });

  test('uses PRDM_SERVER_PORT when set, overriding the 4601 default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const previous = process.env.PRDM_SERVER_PORT;
    process.env.PRDM_SERVER_PORT = '9999';
    try {
      await smokeCheck({ fetchImpl, sleep: fakeSleep().sleep });
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:9999/api/health');
    } finally {
      if (previous === undefined) delete process.env.PRDM_SERVER_PORT;
      else process.env.PRDM_SERVER_PORT = previous;
    }
  });
});
