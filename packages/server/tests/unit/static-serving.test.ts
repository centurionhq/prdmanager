import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const TEST_ENV = buildTestServerEnv();

/**
 * SDD-006 "Local y despliegue" / WO-112: `staticDir` serves `packages/app`'s built bundle with an SPA fallback
 * for any non-`/api`, non-`/collab`, non-`/mcp` path. Uses a throwaway `staticDir` fixture instead of a real Vite
 * build (mirrors `packages/web/tests/integration/static.test.ts`) — the shape (`index.html` + one asset) is all
 * `@fastify/static`/`setNotFoundHandler` care about.
 */
describe('buildServer static serving and SPA fallback', () => {
  let staticDir: string;

  beforeAll(() => {
    staticDir = mkdtempSync(join(tmpdir(), 'prdm-server-static-'));
    mkdirSync(join(staticDir, 'assets'));
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><html><body id="root">app shell</body></html>');
    writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("ok");');
  });

  afterAll(() => {
    rmSync(staticDir, { recursive: true, force: true });
  });

  test('serves a real static asset directly', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('console.log');
    await app.close();
  });

  test('serves index.html at the root path', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('app shell');
    await app.close();
  });

  test('serves index.html for an unknown non-/api path (client-side routing fallback)', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/o/acme/p/demo' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('app shell');
    await app.close();
  });

  test('serves the shell with a real 404 for a path that is not an app route (/o/acme/drift)', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/o/acme/drift' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('app shell');
    expect(() => res.json()).toThrow();
    await app.close();
  });

  test('serves the shell with a real 404 for an unknown root path (/nope)', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('app shell');
    await app.close();
  });

  test('serves the shell with 200 for a valid app route that carries a querystring', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/o/acme/p/web/drift?x=1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('app shell');
    await app.close();
  });

  test('still returns the shared JSON 404 for an unknown /api/* path, never index.html', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'route not found' } });
    await app.close();
  });

  test.each([
    ['/collab', '/collab'],
    ['/mcp', '/mcp'],
  ])('returns the shared JSON 404 for an unrouted %s request, never the SPA shell', async (_label, path) => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: path });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    await app.close();
  });

  test('degrades to the shared JSON 404 (never crashes) when staticDir was never provided', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false });
    const res = await app.inject({ method: 'GET', url: '/anything' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    await app.close();
  });

  test.each([
    ['%2f-encoded traversal', '/assets/..%2f..%2f..%2fetc%2fpasswd'],
    ['%2e-encoded traversal', '/assets/%2e%2e/%2e%2e/%2e%2e/etc/passwd'],
  ])('never leaks a file outside staticDir for a path-traversal attempt: %s (falls through to the SPA shell with a 404 instead)', async (_label, path) => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: path });
    // @fastify/static rejects the escaping path before touching the filesystem; the request then falls through
    // to the not-found handler, which serves the SPA shell with a 404 (the path is not an app route).
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('app shell');
    expect(res.body).not.toContain('root:');
    await app.close();
  });
});
