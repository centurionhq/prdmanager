import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { injectApi, setupWebTest, teardownWebTest, type WebTestContext } from './harness.js';

let ctx: WebTestContext;

beforeEach(async () => {
  ctx = await setupWebTest();
});

afterEach(async () => {
  await teardownWebTest(ctx);
});

describe('GET /api/search', () => {
  test('finds nodes by full-text query', async () => {
    const res = await injectApi(ctx.app, '/api/search?q=grafos');
    expect(res.statusCode).toBe(200);
    const hits = res.json();
    expect(hits.some((hit: { id: string }) => hit.id === 'PRD-001')).toBe(true);
  });

  test('restricts results to the requested labels csv', async () => {
    const res = await injectApi(ctx.app, '/api/search?q=grafos&labels=Feature');
    expect(res.statusCode).toBe(200);
    for (const hit of res.json()) expect(hit.label).toBe('Feature');
  });

  test('rejects an unknown label instead of silently dropping it', async () => {
    const res = await injectApi(ctx.app, '/api/search?q=grafos&labels=Feature,NotALabel');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  test('clamps limit to 1..100 and rejects out-of-range values', async () => {
    const tooLow = await injectApi(ctx.app, '/api/search?q=grafos&limit=0');
    expect(tooLow.statusCode).toBe(400);
    const tooHigh = await injectApi(ctx.app, '/api/search?q=grafos&limit=101');
    expect(tooHigh.statusCode).toBe(400);
    const ok = await injectApi(ctx.app, '/api/search?q=grafos&limit=1');
    expect(ok.statusCode).toBe(200);
  });

  test('requires a non-empty q', async () => {
    const res = await injectApi(ctx.app, '/api/search?q=');
    expect(res.statusCode).toBe(400);
  });
});
