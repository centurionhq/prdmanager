/**
 * `isTrustedRequestOrigin` (SDD-006 §Cabeceras, CSRF y logs, WO-108): pure Origin/Sec-Fetch-Site check
 * used to gate every mutating `/api/app/*` request, ahead of the CSRF token itself.
 */
import { describe, expect, test } from 'vitest';
import { isTrustedRequestOrigin } from '../../src/csrf/origin-check.js';

const TRUSTED = ['https://app.example.test'];

describe('isTrustedRequestOrigin', () => {
  test('Sec-Fetch-Site: same-origin is always trusted', () => {
    expect(isTrustedRequestOrigin({ 'sec-fetch-site': 'same-origin' }, TRUSTED)).toBe(true);
    expect(isTrustedRequestOrigin({ 'sec-fetch-site': 'same-origin', origin: 'https://evil.test' }, TRUSTED)).toBe(true);
  });

  test('Sec-Fetch-Site: cross-site is always rejected, even with a trusted Origin', () => {
    expect(isTrustedRequestOrigin({ 'sec-fetch-site': 'cross-site' }, TRUSTED)).toBe(false);
    expect(isTrustedRequestOrigin({ 'sec-fetch-site': 'cross-site', origin: TRUSTED[0] }, TRUSTED)).toBe(false);
  });

  test('Sec-Fetch-Site: same-site is rejected (not the same origin)', () => {
    expect(isTrustedRequestOrigin({ 'sec-fetch-site': 'same-site', origin: TRUSTED[0] }, TRUSTED)).toBe(false);
  });

  test('Sec-Fetch-Site: none is rejected', () => {
    expect(isTrustedRequestOrigin({ 'sec-fetch-site': 'none' }, TRUSTED)).toBe(false);
  });

  test('absent Sec-Fetch-Site is trusted only when Origin matches exactly', () => {
    expect(isTrustedRequestOrigin({ origin: TRUSTED[0] }, TRUSTED)).toBe(true);
    expect(isTrustedRequestOrigin({ origin: 'https://evil.test' }, TRUSTED)).toBe(false);
  });

  test('absent Sec-Fetch-Site and absent Origin is rejected', () => {
    expect(isTrustedRequestOrigin({}, TRUSTED)).toBe(false);
  });

  test('is case-insensitive on the Sec-Fetch-Site value', () => {
    expect(isTrustedRequestOrigin({ 'sec-fetch-site': 'Same-Origin' }, TRUSTED)).toBe(true);
  });

  test('array-valued headers use only the first entry', () => {
    expect(isTrustedRequestOrigin({ 'sec-fetch-site': ['same-origin', 'cross-site'] }, TRUSTED)).toBe(true);
    expect(isTrustedRequestOrigin({ origin: [TRUSTED[0]!, 'https://evil.test'] }, TRUSTED)).toBe(true);
  });
});
