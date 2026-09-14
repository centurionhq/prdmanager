import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { injectCspNonce } from '../../src/spa-html.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const TEST_ENV = buildTestServerEnv();

describe('injectCspNonce (pure)', () => {
  test('replaces the placeholder meta tag with the real nonce', () => {
    const html = '<head><meta name="csp-nonce" content="" /></head>';
    expect(injectCspNonce(html, 'abc123==')).toBe('<head><meta name="csp-nonce" content="abc123==" /></head>');
  });

  test('is a no-op when the placeholder is absent (never throws)', () => {
    const html = '<html><body id="root">app shell</body></html>';
    expect(injectCspNonce(html, 'abc123==')).toBe(html);
  });
});

describe('CSP nonce wired into the served index.html (SDD-008 §"Editor")', () => {
  let staticDir: string;

  beforeAll(() => {
    staticDir = mkdtempSync(join(tmpdir(), 'prdm-server-spa-html-'));
    writeFileSync(
      join(staticDir, 'index.html'),
      '<!doctype html><html><head><meta name="csp-nonce" content="" /></head><body id="root">app shell</body></html>',
    );
  });

  afterAll(() => {
    rmSync(staticDir, { recursive: true, force: true });
  });

  function extractNonce(html: string): string {
    const match = /<meta name="csp-nonce" content="([^"]*)"/.exec(html);
    if (!match?.[1]) throw new Error(`no csp-nonce meta tag found in: ${html}`);
    return match[1];
  }

  test('the root path gets a real, non-empty nonce matching the response CSP header', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const nonce = extractNonce(res.body);
    expect(nonce.length).toBeGreaterThan(0);
    expect(res.headers['content-security-policy']).toContain(`'nonce-${nonce}'`);
    await app.close();
  });

  test('an SPA-fallback (client-side routing) path also gets a real nonce, via setNotFoundHandler', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const res = await app.inject({ method: 'GET', url: '/o/acme/p/demo/documents/PRD-001' });
    expect(res.statusCode).toBe(200);
    const nonce = extractNonce(res.body);
    expect(nonce.length).toBeGreaterThan(0);
    expect(res.headers['content-security-policy']).toContain(`'nonce-${nonce}'`);
    await app.close();
  });

  test('two different requests get two different nonces (never a cached/reused value)', async () => {
    const app = buildServer({ env: TEST_ENV, logger: false, staticDir });
    const first = extractNonce((await app.inject({ method: 'GET', url: '/' })).body);
    const second = extractNonce((await app.inject({ method: 'GET', url: '/' })).body);
    expect(first).not.toBe(second);
    await app.close();
  });
});
