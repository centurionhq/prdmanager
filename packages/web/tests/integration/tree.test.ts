import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildForest } from '@prdm/core';
import { injectApi, setupWebTest, teardownWebTest, type WebTestContext } from './harness.js';

let ctx: WebTestContext;

beforeEach(async () => {
  ctx = await setupWebTest();
});

afterEach(async () => {
  await teardownWebTest(ctx);
});

describe('GET /api/tree', () => {
  test('without root, matches buildForest(store.fullGraph())', async () => {
    const res = await injectApi(ctx.app, '/api/tree');
    expect(res.statusCode).toBe(200);
    const expected = buildForest(await ctx.store.fullGraph());
    expect(res.json()).toEqual({ forest: expected });
  });

  test('with root, matches buildForest(store.branch(root))', async () => {
    const res = await injectApi(ctx.app, '/api/tree?root=WO-001');
    expect(res.statusCode).toBe(200);
    const expected = buildForest(await ctx.store.branch('WO-001'));
    expect(res.json()).toEqual({ forest: expected });
  });

  test('returns 404 for a well-formed but unknown root', async () => {
    const res = await injectApi(ctx.app, '/api/tree?root=PRD-999');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'PRD-999 not found' } });
  });

  test('returns 400 for a malformed root', async () => {
    const res = await injectApi(ctx.app, '/api/tree?root=not-an-id');
    expect(res.statusCode).toBe(400);
  });
});
