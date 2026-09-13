import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { NotFoundError, setErrorHandler, setNotFoundHandler, ValidationError } from '../../src/errors.js';

function buildTestApp(options: { hasStatic?: boolean } = {}) {
  const app = Fastify({ logger: false });
  app.get('/api/boom-validation', async () => {
    throw new ValidationError('bad input');
  });
  app.get('/api/boom-not-found', async () => {
    throw new NotFoundError('PRD-404 not found');
  });
  app.get('/api/boom-internal', async () => {
    throw new Error('neo4j://user:secret@internal-host:7687 is unreachable');
  });
  app.get('/api/ok', async () => ({ ok: true }));
  setErrorHandler(app);
  setNotFoundHandler(app, { hasStatic: options.hasStatic ?? false });
  return app;
}

describe('setErrorHandler', () => {
  test('maps ValidationError to 400 with its message', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/boom-validation' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: { code: 'validation_error', message: 'bad input' } });
  });

  test('maps NotFoundError to 404 with its message', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/boom-not-found' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'PRD-404 not found' } });
  });

  test('maps any other error to a fixed 500 message, never leaking err.message', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/boom-internal' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal_error', message: 'internal error' } });
    expect(res.body).not.toMatch(/secret/);
    expect(res.body).not.toMatch(/neo4j:/);
  });

  test('lets successful responses through untouched', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/ok' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('setNotFoundHandler', () => {
  test('returns a JSON 404 for an unmatched /api/* route', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
  });

  test('never returns index.html for an unmatched /api/* route even when static is enabled', async () => {
    const app = buildTestApp({ hasStatic: true });
    const res = await app.inject({ method: 'GET', url: '/api/still-not-a-route' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
  });

  test('falls back to a JSON 404 (not a crash) for a non-/api route when no static dir is configured', async () => {
    const app = buildTestApp({ hasStatic: false });
    const res = await app.inject({ method: 'GET', url: '/some/spa/route' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
  });
});
