/**
 * `parseServerUrl` (SDD-010, WO-187): https required unless loopback, validated with `URL`.
 */
import { describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { parseServerUrl } from '../../src/remote/server-url.js';

describe('parseServerUrl (WO-187)', () => {
  test('accepts a https:// server', () => {
    expect(parseServerUrl('https://app.example.test').origin).toBe('https://app.example.test');
  });

  test('accepts http:// only for loopback hosts', () => {
    expect(parseServerUrl('http://127.0.0.1:4600').origin).toBe('http://127.0.0.1:4600');
    expect(parseServerUrl('http://localhost:4600').origin).toBe('http://localhost:4600');
    expect(parseServerUrl('http://[::1]:4600').origin).toBe('http://[::1]:4600');
  });

  test('rejects http:// for a non-loopback host', () => {
    expect(() => parseServerUrl('http://app.example.test')).toThrow(CliError);
  });

  test('rejects a malformed URL', () => {
    expect(() => parseServerUrl('not a url')).toThrow(CliError);
  });
});
