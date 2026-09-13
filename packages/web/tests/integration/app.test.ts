import { afterEach, describe, expect, test } from 'vitest';
import { injectApi, setupWebTest, teardownWebTest, TEST_HOST_HEADER, type WebTestContext } from './harness.js';

let ctx: WebTestContext | undefined;

afterEach(async () => {
  if (ctx) await teardownWebTest(ctx);
  ctx = undefined;
});

describe('buildApp', () => {
  test('boots against a real Neo4j-backed store and closes cleanly', async () => {
    ctx = await setupWebTest();
    expect(ctx.app.server.listening).toBe(false); // never calls listen() itself (SDD-005 "Arquitectura")
    await expect(teardownWebTest(ctx)).resolves.toBeUndefined();
    ctx = undefined;
  });

  test('returns a JSON 404 for an unknown /api/* route, never index.html', async () => {
    ctx = await setupWebTest();
    const res = await injectApi(ctx.app, '/api/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
  });

  test('rejects a request with a spoofed Host header with 403, before hitting the store', async () => {
    ctx = await setupWebTest();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/does-not-exist', headers: { host: 'evil.example:4600' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'validation_error', message: 'invalid Host header' } });
  });

  test('accepts the localhost alias for the configured port', async () => {
    ctx = await setupWebTest();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/does-not-exist', headers: { host: 'localhost:4600' } });
    expect(res.statusCode).toBe(404); // guard passed; only the route itself is missing
  });

  test('marks every /api/* response Cache-Control: no-store', async () => {
    ctx = await setupWebTest();
    const res = await injectApi(ctx.app, '/api/does-not-exist');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('honors an explicit port override for the Host guard', async () => {
    ctx = await setupWebTest();
    await teardownWebTest(ctx);
    ctx = undefined;

    const other = await setupWebTest({ port: 4601 });
    const wrongPort = await other.app.inject({ method: 'GET', url: '/api/does-not-exist', headers: { host: TEST_HOST_HEADER } });
    expect(wrongPort.statusCode).toBe(403);
    const rightPort = await other.app.inject({ method: 'GET', url: '/api/does-not-exist', headers: { host: '127.0.0.1:4601' } });
    expect(rightPort.statusCode).toBe(404);
    await teardownWebTest(other);
  });
});
