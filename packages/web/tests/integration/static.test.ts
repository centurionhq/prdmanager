import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { injectApi, setupWebTest, teardownWebTest, type WebTestContext } from './harness.js';

/**
 * SDD-005 WO-056: static serving from a built `dist/client`, SPA fallback for unknown non-`/api` paths, and the
 * production security headers on every response. Uses a throwaway `staticDir` fixture instead of a real Vite
 * build — the shape (`index.html` + one asset) is all `@fastify/static`/`setNotFoundHandler` care about.
 */
let staticDir: string;
let ctx: WebTestContext;

beforeAll(async () => {
  staticDir = mkdtempSync(join(tmpdir(), 'prdm-web-static-'));
  mkdirSync(join(staticDir, 'assets'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><html><body id="root">app shell</body></html>');
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("ok");');
  ctx = await setupWebTest({ staticDir });
});

afterAll(async () => {
  await teardownWebTest(ctx);
  rmSync(staticDir, { recursive: true, force: true });
});

describe('static bundle serving and SPA fallback', () => {
  it('serves a real static asset directly', async () => {
    const res = await injectApi(ctx.app, '/assets/app.js');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('console.log');
  });

  it('serves index.html for an unknown non-/api path (client-side routing fallback)', async () => {
    const res = await injectApi(ctx.app, '/features/PRD-004');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('app shell');
  });

  it('serves index.html at the root path', async () => {
    const res = await injectApi(ctx.app, '/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('app shell');
  });

  it('still returns a JSON 404 for an unknown /api/* path, never index.html', async () => {
    const res = await injectApi(ctx.app, '/api/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual({ error: { code: 'not_found', message: 'route not found' } });
  });

  it.each([
    ['%2f-encoded traversal', '/assets/..%2f..%2f..%2fetc%2fpasswd'],
    ['%2e-encoded traversal', '/assets/%2e%2e/%2e%2e/%2e%2e/etc/passwd'],
  ])('never leaks a file outside staticDir for a path-traversal attempt: %s (falls through to the SPA shell instead)', async (_label, path) => {
    const res = await injectApi(ctx.app, path);
    // @fastify/static rejects the escaping path before touching the filesystem; the request then falls through
    // to the same SPA fallback any other unknown non-/api path gets. Asserted by shape (status + content-type),
    // not just body content (F6 security review): a future regression that returned a 500 with a stack trace, or
    // any other unintended response, would still contain no /etc/passwd content but must still fail this test.
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).not.toContain('root:');
  });

  it('applies the production security headers to every response, static and API alike', async () => {
    const html = await injectApi(ctx.app, '/');
    expect(html.headers['content-security-policy']).toContain("default-src 'self'");
    expect(html.headers['x-content-type-options']).toBe('nosniff');
    expect(html.headers['referrer-policy']).toBe('no-referrer');

    const api = await injectApi(ctx.app, '/api/health');
    expect(api.headers['content-security-policy']).toContain("default-src 'self'");
    expect(api.headers['x-content-type-options']).toBe('nosniff');
  });
});
