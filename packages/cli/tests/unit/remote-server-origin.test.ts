import type { RemoteProjectConfig } from '@prdm/core';
import { describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { isCi, resolveRemoteServerOrigin } from '../../src/remote/server-origin.js';

function remote(server = 'https://app.example.com'): RemoteProjectConfig {
  return { server, org: 'acme', project: 'widgets', offlinePolicy: 'warn' };
}

describe('isCi (SDD-010, WO-190)', () => {
  test('true for CI=true or CI=1', () => {
    expect(isCi({ CI: 'true' })).toBe(true);
    expect(isCi({ CI: '1' })).toBe(true);
  });
  test('false when unset or any other value', () => {
    expect(isCi({})).toBe(false);
    expect(isCi({ CI: 'false' })).toBe(false);
  });
});

describe('resolveRemoteServerOrigin (SDD-010, WO-190)', () => {
  test('outside CI, trusts .prdm.yaml when PRDM_SERVER is unset', () => {
    expect(resolveRemoteServerOrigin(remote(), {})).toBe('https://app.example.com');
  });

  test('outside CI, cross-checks PRDM_SERVER when present and agreeing', () => {
    expect(resolveRemoteServerOrigin(remote(), { PRDM_SERVER: 'https://app.example.com' })).toBe('https://app.example.com');
  });

  test('outside CI, aborts when PRDM_SERVER disagrees', () => {
    expect(() => resolveRemoteServerOrigin(remote(), { PRDM_SERVER: 'https://other.example.com' })).toThrow(CliError);
  });

  test('in CI, missing PRDM_SERVER is a hard, clear error', () => {
    expect(() => resolveRemoteServerOrigin(remote(), { CI: 'true' })).toThrow(/PRDM_SERVER is required in CI/);
  });

  test('in CI, an agreeing PRDM_SERVER resolves normally', () => {
    expect(resolveRemoteServerOrigin(remote(), { CI: 'true', PRDM_SERVER: 'https://app.example.com' })).toBe('https://app.example.com');
  });

  test('in CI, a disagreeing PRDM_SERVER still aborts (repo never wins)', () => {
    expect(() => resolveRemoteServerOrigin(remote(), { CI: 'true', PRDM_SERVER: 'https://other.example.com' })).toThrow(CliError);
  });
});
