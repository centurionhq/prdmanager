import { describe, expect, test } from 'vitest';
import { DEFAULT_SERVER_PORT, resolveServerEnv, resolveServerPort } from '../../src/env.js';

describe('resolveServerEnv', () => {
  test('defaults to development when NODE_ENV is unset', () => {
    expect(resolveServerEnv({})).toEqual({ nodeEnv: 'development' });
  });

  test('passes through production and test', () => {
    expect(resolveServerEnv({ NODE_ENV: 'production' })).toEqual({ nodeEnv: 'production' });
    expect(resolveServerEnv({ NODE_ENV: 'test' })).toEqual({ nodeEnv: 'test' });
  });

  test('treats any other value as development', () => {
    expect(resolveServerEnv({ NODE_ENV: 'staging' })).toEqual({ nodeEnv: 'development' });
  });
});

describe('resolveServerPort', () => {
  test('defaults to 4601 when PRDM_SERVER_PORT is unset', () => {
    expect(resolveServerPort({})).toBe(DEFAULT_SERVER_PORT);
  });

  test('parses a valid PRDM_SERVER_PORT', () => {
    expect(resolveServerPort({ PRDM_SERVER_PORT: '8080' })).toBe(8080);
  });

  test.each(['0', '65536', 'abc', '3.5', '-1'])('rejects an invalid PRDM_SERVER_PORT %s', (value) => {
    expect(() => resolveServerPort({ PRDM_SERVER_PORT: value })).toThrow(/PRDM_SERVER_PORT/);
  });
});
