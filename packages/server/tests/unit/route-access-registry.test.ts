/**
 * WO-110 — `installRouteAccessRegistry`: registering a route without `config.access` throws
 * immediately, at registration time; a properly declared route is recorded into the registry.
 */
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { installRouteAccessRegistry } from '../../src/access/route-registry.js';

describe('installRouteAccessRegistry (WO-110)', () => {
  test('throws synchronously when a route is registered without config.access', () => {
    const app = Fastify();
    installRouteAccessRegistry(app);

    expect(() => app.get('/api/app/undeclared', async () => ({}))).toThrow(/missing config\.access/);
  });

  test('records a declared route (method, path, access) into the registry', () => {
    const app = Fastify();
    const registry = installRouteAccessRegistry(app);

    app.get('/api/health', { config: { access: { public: true } } }, async () => ({}));
    app.post<{ Params: { id: string } }>('/api/app/widgets/:id', { config: { access: { kind: 'session' } } }, async () => ({}));
    app.get('/api/v1/me', { config: { access: { kind: 'bearer', scope: 'any' } } }, async () => ({}));

    expect(registry.routes).toEqual([
      { method: 'GET', path: '/api/health', access: { public: true } },
      { method: 'POST', path: '/api/app/widgets/:id', access: { kind: 'session' } },
      { method: 'GET', path: '/api/v1/me', access: { kind: 'bearer', scope: 'any' } },
    ]);
  });

  test('a route missing config.access names its own method and path in the thrown error', () => {
    const app = Fastify();
    installRouteAccessRegistry(app);

    expect(() => app.delete('/api/app/organizations/:orgSlug', async () => ({}))).toThrow('DELETE /api/app/organizations/:orgSlug');
  });
});
