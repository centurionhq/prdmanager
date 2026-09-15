/**
 * WO-116 addition: `GET /reset-password/:token` is reachable (the better-auth redirect callback that
 * makes the emailed reset link land the browser back on the dashboard's `/reset-password` screen with
 * `?token=...`), but only for `GET` — the WO-093 learning test still expects the literal
 * `/reset-password/:token` template path to 404 for every other method.
 */
import { describe, expect, it } from 'vitest';
import { AUTH_ALLOWED_PATHS, isAllowedAuthPath } from '../../src/auth/allowlist.js';

describe('isAllowedAuthPath (WO-116 reset-password callback)', () => {
  it('allows a GET to a concrete reset-password token path', () => {
    expect(isAllowedAuthPath('/reset-password/abc123XYZ', 'GET')).toBe(true);
  });

  it('rejects a POST to the same shape (only the real GET-only endpoint is exempted)', () => {
    expect(isAllowedAuthPath('/reset-password/abc123XYZ', 'POST')).toBe(false);
  });

  it('still rejects the literal ":token" template path with a non-GET method', () => {
    expect(isAllowedAuthPath('/reset-password/:token', 'POST')).toBe(false);
  });

  it('never matches a path with an extra segment', () => {
    expect(isAllowedAuthPath('/reset-password/abc/extra', 'GET')).toBe(false);
  });

  it('exact-match allowlisted paths are unaffected', () => {
    for (const path of AUTH_ALLOWED_PATHS) {
      expect(isAllowedAuthPath(path, 'POST')).toBe(true);
    }
  });
});
