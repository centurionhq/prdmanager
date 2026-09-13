import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BASELINE_PATH } from '@prdm/core';
import { injectApi, setupWebTest, teardownWebTest, type WebTestContext } from './harness.js';

// Not exported by @prdm/core (SymbolCache keeps it private); mirrors packages/core/src/sync/symbol-cache.ts's CACHE_PATH.
const SYMBOL_CACHE_PATH = '.prdm/symbol-cache.json';

let ctx: WebTestContext;

beforeEach(async () => {
  ctx = await setupWebTest();
});

afterEach(async () => {
  await teardownWebTest(ctx);
});

describe('GET /api/drift', () => {
  test('returns a RefreshReport shape from engine.inspect()', async () => {
    const res = await injectApi(ctx.app, '/api/drift');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('issues');
    expect(body).toHaveProperty('governed');
    expect(body).toHaveProperty('hasBlockingIssues');
  });

  test('never writes the baseline or symbol cache, and never calls store.writeSnapshot', async () => {
    const baselinePath = join(ctx.root, BASELINE_PATH);
    const symbolCachePath = join(ctx.root, SYMBOL_CACHE_PATH);
    const baselineBefore = statSync(baselinePath).mtimeMs;
    // `.prdm/symbol-cache.json` is only ever written by a real refresh() (SDD-005 "Ciclo de vida del Engine"); the
    // fixture's refresh() during setup may or may not have produced one depending on what needed resolving, so
    // this asserts "unchanged" against whichever state (present or absent) that left behind.
    const symbolCacheExistedBefore = existsSync(symbolCachePath);
    const symbolCacheBefore = symbolCacheExistedBefore ? statSync(symbolCachePath).mtimeMs : null;
    const writeSnapshotSpy = vi.spyOn(ctx.store, 'writeSnapshot');

    const res = await injectApi(ctx.app, '/api/drift');

    expect(res.statusCode).toBe(200);
    expect(statSync(baselinePath).mtimeMs).toBe(baselineBefore);
    expect(existsSync(symbolCachePath)).toBe(symbolCacheExistedBefore);
    if (symbolCacheExistedBefore) expect(statSync(symbolCachePath).mtimeMs).toBe(symbolCacheBefore);
    expect(writeSnapshotSpy).not.toHaveBeenCalled();
  });

  test('collapses concurrent requests into a single engine.inspect() call (single-flight)', async () => {
    const inspectSpy = vi.spyOn(ctx.engine, 'inspect');
    const [first, second] = await Promise.all([injectApi(ctx.app, '/api/drift'), injectApi(ctx.app, '/api/drift')]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(inspectSpy).toHaveBeenCalledTimes(1);
  });

  test('serves a cached result on an immediate follow-up call (short TTL)', async () => {
    await injectApi(ctx.app, '/api/drift');
    const inspectSpy = vi.spyOn(ctx.engine, 'inspect');
    const res = await injectApi(ctx.app, '/api/drift');
    expect(res.statusCode).toBe(200);
    expect(inspectSpy).not.toHaveBeenCalled();
  });
});
