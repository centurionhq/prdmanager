import { DatabaseBusyError, StatementTimedOutError } from '@prdm/core';
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  setErrorHandler,
  setNotFoundHandler,
  UnauthorizedError,
  ValidationError,
} from '../../src/errors.js';

function buildTestApp() {
  const app = Fastify({ logger: false });
  app.get('/api/validation', async () => {
    throw new ValidationError('bad input');
  });
  app.get('/api/unauthorized', async () => {
    throw new UnauthorizedError();
  });
  app.get('/api/forbidden', async () => {
    throw new ForbiddenError();
  });
  app.get('/api/not-found', async () => {
    throw new NotFoundError('doc-404 not found');
  });
  app.get('/api/conflict', async () => {
    throw new ConflictError('already published');
  });
  app.get('/api/rate-limited', async () => {
    throw new RateLimitedError();
  });
  app.get('/api/db-busy', async () => {
    throw new DatabaseBusyError('database busy', { cause: new Error('timeout exceeded when trying to connect') });
  });
  app.get('/api/statement-timeout', async () => {
    throw new StatementTimedOutError('statement timed out', { cause: new Error('canceling statement due to statement timeout') });
  });
  app.get('/api/raw-pool-timeout', async () => {
    throw new Error('timeout exceeded when trying to connect to postgres://user:secret@db:5432');
  });
  app.get('/api/raw-statement-timeout', async () => {
    throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  });
  app.get('/api/boom', async () => {
    throw new Error('boom');
  });
  app.get('/api/unavailable', async () => {
    throw new ServiceUnavailableError('x', 3);
  });
  app.post('/api/small-body', { bodyLimit: 16 }, async () => ({ ok: true }));
  app.get('/api/ok', async () => ({ ok: true }));
  setErrorHandler(app);
  setNotFoundHandler(app);
  return app;
}

describe('setErrorHandler', () => {
  test.each([
    ['/api/validation', 400, 'validation_error', 'bad input'],
    ['/api/unauthorized', 401, 'unauthorized', 'unauthorized'],
    ['/api/forbidden', 403, 'forbidden', 'forbidden'],
    ['/api/not-found', 404, 'not_found', 'doc-404 not found'],
    ['/api/conflict', 409, 'conflict', 'already published'],
    ['/api/rate-limited', 429, 'rate_limited', 'rate limited'],
  ])('maps %s to %i with the shared envelope', async (url, status, code, message) => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: { code, message } });
    await app.close();
  });

  test('maps DatabaseBusyError to 503 with retry-after: 5 and a fixed message', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/db-busy' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'service_unavailable', message: 'database busy, retry shortly' } });
    expect(res.headers['retry-after']).toBe('5');
    await app.close();
  });

  test('maps StatementTimedOutError to 503 without retry-after', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/statement-timeout' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'service_unavailable', message: 'statement timed out' } });
    expect(res.headers['retry-after']).toBeUndefined();
    await app.close();
  });

  // WO-647: con el pool saturado el primer consumidor es la auth bearer (preHandler), que lanza el error crudo del driver.
  test('maps a raw pool connect timeout (no typed wrapper) to 503 with retry-after: 5 and never leaks the driver message', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/raw-pool-timeout' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'service_unavailable', message: 'database busy, retry shortly' } });
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).not.toContain('timeout exceeded');
    await app.close();
  });

  test('maps a raw SQLSTATE 57014 statement timeout to 503 without retry-after', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/raw-statement-timeout' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: 'service_unavailable', message: 'statement timed out' } });
    expect(res.headers['retry-after']).toBeUndefined();
    await app.close();
  });

  test('keeps an unrelated error as 500 internal_error', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal_error', message: 'internal error' } });
    await app.close();
  });

  test('maps a hand-thrown ServiceUnavailableError to 503 with its own retry-after', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/unavailable' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('3');
    await app.close();
  });

  test('maps a body over the route bodyLimit to 413 payload_too_large, not a 500', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/small-body', payload: { pad: 'x'.repeat(64) } });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({
      error: { code: 'payload_too_large', message: 'request body exceeds the allowed limit for this endpoint' },
    });
    await app.close();
  });

  test('lets successful responses through untouched', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/ok' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});

describe('setNotFoundHandler', () => {
  test('returns a JSON 404 with the shared envelope for any unmatched route', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
    await app.close();
  });
});
