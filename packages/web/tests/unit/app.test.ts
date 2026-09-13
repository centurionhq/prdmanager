import { describe, expect, test } from 'vitest';
import { isAllowedHost } from '../../src/app.js';

describe('isAllowedHost', () => {
  test('accepts the loopback IP alias at the configured port', () => {
    expect(isAllowedHost('127.0.0.1:4600', 4600)).toBe(true);
  });

  test('accepts the localhost alias at the configured port', () => {
    expect(isAllowedHost('localhost:4600', 4600)).toBe(true);
  });

  test('rejects a mismatched port', () => {
    expect(isAllowedHost('127.0.0.1:4600', 4601)).toBe(false);
  });

  test('rejects an arbitrary hostname, even one that could resolve to 127.0.0.1', () => {
    expect(isAllowedHost('evil.example:4600', 4600)).toBe(false);
  });

  test('rejects a missing Host header', () => {
    expect(isAllowedHost(undefined, 4600)).toBe(false);
  });

  test('rejects a bare hostname with no port suffix', () => {
    expect(isAllowedHost('127.0.0.1', 4600)).toBe(false);
  });
});
