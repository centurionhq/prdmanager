import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CliContext, CliDeps } from '../../src/program.js';

const { withContext } = await import('../../src/program.js');

function fakeCtx(overrides: Partial<CliContext> = {}): { ctx: CliContext; recover: ReturnType<typeof vi.fn>; assertSchemaCurrent: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const recover = vi.fn(async () => undefined);
  const assertSchemaCurrent = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const ctx: CliContext = {
    config: {} as never,
    db: { assertSchemaCurrent } as never,
    store: {} as never,
    engine: { recover } as never,
    close,
    ...overrides,
  };
  return { ctx, recover, assertSchemaCurrent, close };
}

function depsFor(ctx: CliContext): CliDeps {
  return { root: '/repo', stdout: () => {}, stderr: () => {}, openContext: async () => ctx };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('withContext calls engine.recover() before serving reads (SDD-002 "Transacción atómica", WO-025)', () => {
  test('recovers before running the command by default', async () => {
    const { ctx, recover } = fakeCtx();
    const order: string[] = [];
    recover.mockImplementation(async () => {
      order.push('recover');
    });

    await withContext(depsFor(ctx), async () => {
      order.push('fn');
    });

    expect(recover).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['recover', 'fn']);
  });

  test('skipRecover: true never calls engine.recover() (db migrate/status/doctor)', async () => {
    const { ctx, recover } = fakeCtx();

    await withContext(depsFor(ctx), async () => undefined, { skipRecover: true });

    expect(recover).not.toHaveBeenCalled();
  });

  test('recovers even when requireSchema is false (db migrate/status still opt out via skipRecover)', async () => {
    const { ctx, recover, assertSchemaCurrent } = fakeCtx();

    await withContext(depsFor(ctx), async () => undefined, { requireSchema: false });

    expect(assertSchemaCurrent).not.toHaveBeenCalled();
    expect(recover).toHaveBeenCalledTimes(1);
  });

  test('a stale graph is refreshed before the command reads it (fake engine simulating a planted .prdm/graph-stale marker)', async () => {
    let staleMarkerPresent = true;
    const { ctx, recover } = fakeCtx();
    recover.mockImplementation(async () => {
      // Mirrors Engine#recoverLocked: replays journals, and if the stale marker exists, refreshes then removes it.
      if (staleMarkerPresent) staleMarkerPresent = false;
    });

    let sawStaleDuringRead = false;
    await withContext(depsFor(ctx), async () => {
      sawStaleDuringRead = staleMarkerPresent;
    });

    expect(sawStaleDuringRead).toBe(false);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  test('closes the context even if engine.recover() throws', async () => {
    const { ctx, recover, close } = fakeCtx();
    recover.mockRejectedValue(new Error('replay failed'));

    await expect(withContext(depsFor(ctx), async () => undefined)).rejects.toThrow('replay failed');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
