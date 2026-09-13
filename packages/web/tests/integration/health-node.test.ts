import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { injectApi, setupWebTest, teardownWebTest, type WebTestContext } from './harness.js';

let ctx: WebTestContext;

beforeEach(async () => {
  ctx = await setupWebTest();
});

afterEach(async () => {
  await teardownWebTest(ctx);
});

describe('GET /api/health', () => {
  test('returns 200 {status: "ok"} without touching Neo4j', async () => {
    const res = await injectApi(ctx.app, '/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/node/:id', () => {
  test('returns a NodeDetail for a known document id', async () => {
    const res = await injectApi(ctx.app, '/api/node/PRD-001');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.node).toMatchObject({ id: 'PRD-001', label: 'Feature' });
    expect(Array.isArray(body.links)).toBe(true);
  });

  test('returns 404 for a well-formed but unknown id', async () => {
    const res = await injectApi(ctx.app, '/api/node/PRD-999');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'PRD-999 not found' } });
  });

  test('returns 400 for a malformed id', async () => {
    const res = await injectApi(ctx.app, '/api/node/not-an-id');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});
