import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { injectApi, setupWebTest, teardownWebTest, type WebTestContext } from './harness.js';

let ctx: WebTestContext;

beforeEach(async () => {
  ctx = await setupWebTest();
});

afterEach(async () => {
  await teardownWebTest(ctx);
});

describe('GET /api/work-orders', () => {
  test('lists every work order with no filters', async () => {
    const res = await injectApi(ctx.app, '/api/work-orders');
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.some((wo: { id: string }) => wo.id === 'WO-001')).toBe(true);
  });

  test('filters by status', async () => {
    const res = await injectApi(ctx.app, '/api/work-orders?status=done');
    expect(res.statusCode).toBe(200);
    for (const wo of res.json()) expect(wo.status).toBe('done');
  });

  test('filters by blueprint', async () => {
    const res = await injectApi(ctx.app, '/api/work-orders?blueprint=SDD-001');
    expect(res.statusCode).toBe(200);
    for (const wo of res.json()) expect(wo.blueprints).toContain('SDD-001');
  });

  test('rejects an unknown status', async () => {
    const res = await injectApi(ctx.app, '/api/work-orders?status=bogus');
    expect(res.statusCode).toBe(400);
  });

  test('rejects a malformed blueprint id', async () => {
    const res = await injectApi(ctx.app, '/api/work-orders?blueprint=not-an-id');
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/work-orders/:id', () => {
  test('returns the work order context bundle', async () => {
    const res = await injectApi(ctx.app, '/api/work-orders/WO-001');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workOrder).toMatchObject({ id: 'WO-001' });
    expect(body.blueprints.map((b: { id: string }) => b.id)).toEqual(['SDD-001']);
  });

  test('returns 404 for a well-formed but unknown id', async () => {
    const res = await injectApi(ctx.app, '/api/work-orders/WO-999');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'WO-999 not found' } });
  });

  test('returns 400 for a malformed id', async () => {
    const res = await injectApi(ctx.app, '/api/work-orders/not-an-id');
    expect(res.statusCode).toBe(400);
  });
});
