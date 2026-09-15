/**
 * `resolveRemoteCredential` (SDD-010, WO-239): `sync.ts`/`commit-msg.ts`/`check-range.ts` previously only
 * ever read a token from the local on-disk credentials store, so a fresh CI runner (no such file) could
 * never authenticate in remote mode — even though `server-origin.ts` already treats `PRDM_SERVER` as
 * mandatory in CI and SDD-010 pairs it with `PRDM_TOKEN`. Mirrors `resolveRemoteServerOrigin`'s own
 * CI-mandatory shape exactly.
 */
import { describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { resolveRemoteCredential, saveCredentials } from '../../src/remote/credentials.js';
import { makeTmpDir, removeDir } from '@prdm/testkit';

const ORIGIN = 'https://app.example.com';

describe('resolveRemoteCredential (SDD-010, WO-239)', () => {
  test('in CI, PRDM_TOKEN is used directly, never touching the local store', () => {
    const xdgHome = makeTmpDir('prdm-cred-resolve-ci-');
    try {
      const token = resolveRemoteCredential(ORIGIN, { CI: 'true', PRDM_TOKEN: 'prdm_pat_ci', XDG_CONFIG_HOME: xdgHome });
      expect(token).toBe('prdm_pat_ci');
    } finally {
      removeDir(xdgHome);
    }
  });

  test('in CI, missing PRDM_TOKEN is a hard, clear error — never silently falls back to a local file', () => {
    expect(() => resolveRemoteCredential(ORIGIN, { CI: 'true' })).toThrow(/PRDM_TOKEN is required in CI/);
    expect(() => resolveRemoteCredential(ORIGIN, { CI: 'true' })).toThrow(CliError);
  });

  test('outside CI, falls back to the local credentials store when PRDM_TOKEN is unset', () => {
    const xdgHome = makeTmpDir('prdm-cred-resolve-local-');
    try {
      saveCredentials({ [ORIGIN]: { token: 'prdm_pat_local' } }, { XDG_CONFIG_HOME: xdgHome });
      expect(resolveRemoteCredential(ORIGIN, { XDG_CONFIG_HOME: xdgHome })).toBe('prdm_pat_local');
    } finally {
      removeDir(xdgHome);
    }
  });

  test('outside CI, PRDM_TOKEN (when set) takes precedence over the local store', () => {
    const xdgHome = makeTmpDir('prdm-cred-resolve-override-');
    try {
      saveCredentials({ [ORIGIN]: { token: 'prdm_pat_local' } }, { XDG_CONFIG_HOME: xdgHome });
      expect(resolveRemoteCredential(ORIGIN, { PRDM_TOKEN: 'prdm_pat_env', XDG_CONFIG_HOME: xdgHome })).toBe('prdm_pat_env');
    } finally {
      removeDir(xdgHome);
    }
  });

  test('outside CI, no PRDM_TOKEN and no stored credential for this origin: clear "not logged in" error', () => {
    const xdgHome = makeTmpDir('prdm-cred-resolve-missing-');
    try {
      expect(() => resolveRemoteCredential(ORIGIN, { XDG_CONFIG_HOME: xdgHome })).toThrow(/not logged in/);
    } finally {
      removeDir(xdgHome);
    }
  });
});
