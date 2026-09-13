import { describe, expect, test } from 'vitest';
import { resolveWebBind } from '../../src/env.js';

describe('resolveWebBind', () => {
  test('defaults to 127.0.0.1:4600 with no environment set', () => {
    expect(resolveWebBind({})).toEqual({ host: '127.0.0.1', port: 4600 });
  });

  test('honors PRDM_WEB_PORT', () => {
    expect(resolveWebBind({ PRDM_WEB_PORT: '5000' })).toEqual({ host: '127.0.0.1', port: 5000 });
  });

  test('rejects a non-numeric PRDM_WEB_PORT', () => {
    expect(() => resolveWebBind({ PRDM_WEB_PORT: 'not-a-port' })).toThrow(/PRDM_WEB_PORT/);
  });

  test('rejects a PRDM_WEB_PORT out of the 1..65535 range', () => {
    expect(() => resolveWebBind({ PRDM_WEB_PORT: '0' })).toThrow(/PRDM_WEB_PORT/);
    expect(() => resolveWebBind({ PRDM_WEB_PORT: '70000' })).toThrow(/PRDM_WEB_PORT/);
  });

  test('accepts localhost and ::1 as loopback hosts without PRDM_WEB_ALLOW_REMOTE', () => {
    expect(resolveWebBind({ PRDM_WEB_HOST: 'localhost' })).toEqual({ host: 'localhost', port: 4600 });
    expect(resolveWebBind({ PRDM_WEB_HOST: '::1' })).toEqual({ host: '::1', port: 4600 });
  });

  test('refuses to start with a non-loopback PRDM_WEB_HOST unless PRDM_WEB_ALLOW_REMOTE=1', () => {
    expect(() => resolveWebBind({ PRDM_WEB_HOST: '0.0.0.0' })).toThrow(/PRDM_WEB_ALLOW_REMOTE/);
  });

  test('accepts a non-loopback PRDM_WEB_HOST once PRDM_WEB_ALLOW_REMOTE=1 is set', () => {
    expect(resolveWebBind({ PRDM_WEB_HOST: '0.0.0.0', PRDM_WEB_ALLOW_REMOTE: '1' })).toEqual({ host: '0.0.0.0', port: 4600 });
  });
});
