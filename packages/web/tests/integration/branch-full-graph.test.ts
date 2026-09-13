import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { injectApi, setupWebTest, teardownWebTest, type WebTestContext } from './harness.js';

let ctx: WebTestContext;

beforeEach(async () => {
  ctx = await setupWebTest();
});

afterEach(async () => {
  await teardownWebTest(ctx);
});

describe('GET /api/branch/:id', () => {
  test('returns the lineage subgraph for a known node', async () => {
    const res = await injectApi(ctx.app, '/api/branch/WO-001');
    expect(res.statusCode).toBe(200);
    const subgraph = res.json();
    expect(subgraph.nodes.some((n: { ref: string }) => n.ref === 'MRD-001')).toBe(true);
    expect(subgraph.nodes.some((n: { ref: string }) => n.ref === 'WO-001')).toBe(true);
  });

  test('returns 404 for a well-formed but unknown id (never a silently empty subgraph)', async () => {
    const res = await injectApi(ctx.app, '/api/branch/PRD-999');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'PRD-999 not found' } });
  });

  test('returns 400 for a malformed id', async () => {
    const res = await injectApi(ctx.app, '/api/branch/not-an-id');
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/full-graph', () => {
  test('returns the whole project subgraph', async () => {
    const res = await injectApi(ctx.app, '/api/full-graph');
    expect(res.statusCode).toBe(200);
    const subgraph = res.json();
    expect(subgraph.nodes.some((n: { ref: string }) => n.ref === 'PRD-001')).toBe(true);
    expect(Array.isArray(subgraph.edges)).toBe(true);
  });
});
