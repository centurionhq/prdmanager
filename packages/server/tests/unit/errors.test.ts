import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
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
