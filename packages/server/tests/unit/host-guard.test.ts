import { describe, expect, test } from 'vitest';
import { expectedAuthHost, resolveRequestHost } from '../../src/auth/host-guard.js';

describe('expectedAuthHost', () => {
  test('extracts host:port from PRDM_PUBLIC_URL', () => {
    expect(expectedAuthHost('https://app.example.test')).toBe('app.example.test');
    expect(expectedAuthHost('http://127.0.0.1:4601')).toBe('127.0.0.1:4601');
  });
});

describe('resolveRequestHost', () => {
  test('uses the raw Host header when trustProxy is false, ignoring X-Forwarded-Host entirely', () => {
    expect(resolveRequestHost({ host: 'app.example.test', 'x-forwarded-host': 'evil.example' }, false)).toBe('app.example.test');
  });

  test('prefers X-Forwarded-Host over Host when trustProxy is true', () => {
    expect(resolveRequestHost({ host: '127.0.0.1:4601', 'x-forwarded-host': 'app.example.test' }, true)).toBe('app.example.test');
  });

  test('falls back to Host when trustProxy is true but X-Forwarded-Host is absent', () => {
    expect(resolveRequestHost({ host: 'app.example.test' }, true)).toBe('app.example.test');
  });

  test('takes only the first entry of a comma-separated X-Forwarded-Host when trustProxy is true', () => {
    expect(resolveRequestHost({ host: '127.0.0.1', 'x-forwarded-host': 'app.example.test, evil.example' }, true)).toBe('app.example.test');
  });

  test('handles a duplicated X-Forwarded-Host header (array form)', () => {
    expect(resolveRequestHost({ host: '127.0.0.1', 'x-forwarded-host': ['app.example.test', 'evil.example'] }, true)).toBe(
      'app.example.test',
    );
  });
});
