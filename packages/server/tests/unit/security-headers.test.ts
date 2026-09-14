/**
 * `buildContentSecurityPolicy`/`websocketConnectSrc` (SDD-006 §Cabeceras, CSRF y logs, WO-108).
 */
import { describe, expect, test } from 'vitest';
import { buildContentSecurityPolicy, websocketConnectSrc } from '../../src/security-headers.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('websocketConnectSrc', () => {
  test('uses wss:// for an https public URL', () => {
    expect(websocketConnectSrc('https://app.example.test')).toBe('wss://app.example.test');
  });

  test('uses ws:// for an http (dev/localhost) public URL', () => {
    expect(websocketConnectSrc('http://127.0.0.1:4601')).toBe('ws://127.0.0.1:4601');
  });

  test('never emits a bare "wss:"/"ws:" without a host', () => {
    const value = websocketConnectSrc('https://app.example.test');
    expect(value).not.toBe('wss:');
    expect(value.startsWith('wss://')).toBe(true);
  });
});

describe('buildContentSecurityPolicy', () => {
  test('includes the exact public wss host in connect-src, never a bare scheme', () => {
    const env = buildTestServerEnv({ publicUrl: 'https://app.example.test' });
    const csp = buildContentSecurityPolicy(env, 'nonce-value');
    expect(csp).toContain("connect-src 'self' wss://app.example.test");
    expect(csp).not.toMatch(/connect-src[^;]*\bwss:(?!\/\/)/);
  });

  test('includes the per-request nonce in style-src, never unsafe-inline', () => {
    const env = buildTestServerEnv();
    const csp = buildContentSecurityPolicy(env, 'abc123');
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain('unsafe-inline');
  });

  test('sets frame-ancestors none, img-src self+data:, and object-src none', () => {
    const env = buildTestServerEnv();
    const csp = buildContentSecurityPolicy(env, 'n');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("object-src 'none'");
  });
});
