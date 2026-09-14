import { describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const TEST_ENV = buildTestServerEnv();

describe('buildServer', () => {
  test('GET /api/health returns {status: "ok"} without listening', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  test('injects env and clock as decorators, defaulting clock to a real Date factory', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false });
    expect(app.env).toEqual(TEST_ENV);
    expect(app.clock()).toBeInstanceOf(Date);
    await app.close();
  });

  test('honors an injected clock instead of the default', async () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z');
    const app = buildServer({ env: TEST_ENV, logger: false, clock: () => fixed });
    expect(app.clock()).toBe(fixed);
    await app.close();
  });

  test('returns the shared not_found envelope for an unmatched route', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
    await app.close();
  });

  test('maps an unexpected thrown error to a fixed 500, never leaking the real message', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false });
    app.get('/api/boom', async () => {
      throw new Error('postgres://prdm_app:secret@127.0.0.1:5432/prdm is unreachable');
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal_error', message: 'internal error' } });
    expect(res.body).not.toMatch(/secret/);
    await app.close();
  });
});
