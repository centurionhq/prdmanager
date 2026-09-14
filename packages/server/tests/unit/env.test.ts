import { describe, expect, test } from 'vitest';
import { DEFAULT_SERVER_PORT, ServerEnvError, resolveServerEnv } from '../../src/env.js';

const VALID_RAW_ENV: NodeJS.ProcessEnv = {
  PRDM_PUBLIC_URL: 'https://app.example.test',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgres://prdm_app:secret@127.0.0.1:55433/prdm',
  PRDM_TRUSTED_ORIGINS: 'https://app.example.test',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_FROM: 'prdm <no-reply@example.test>',
  NEO4J_PASSWORD: 'test-password',
};

describe('resolveServerEnv', () => {
  test('parses a minimal valid environment with defaults', () => {
    const env = resolveServerEnv(VALID_RAW_ENV);
    expect(env).toEqual({
      nodeEnv: 'development',
      serverPort: DEFAULT_SERVER_PORT,
      publicUrl: 'https://app.example.test',
      betterAuthSecret: 'a'.repeat(32),
      databaseUrl: 'postgres://prdm_app:secret@127.0.0.1:55433/prdm',
      trustedOrigins: ['https://app.example.test'],
      trustProxy: false,
      collabMaxPayloadBytes: 1_048_576,
      collabLimits: {
        maxRenderedBytes: 512 * 1024,
        maxEncodedStateBytes: 20 * 1024 * 1024,
        maxConnectionsPerUser: 20,
        maxConnectionsPerDocument: 50,
        maxUpdatesPerSecPerUser: 30,
        maxUpdatesPerSecPerDocument: 100,
      },
      smtp: { host: '127.0.0.1', port: 1025, secure: false, from: 'prdm <no-reply@example.test>' },
      deepseek: undefined,
      neo4j: { uri: 'neo4j://127.0.0.1:7687', username: 'neo4j', password: 'test-password', database: 'neo4j' },
    });
  });

  test('passes through NODE_ENV production and test, defaulting anything else to development', () => {
    expect(resolveServerEnv({ ...VALID_RAW_ENV, NODE_ENV: 'production' }).nodeEnv).toBe('production');
    expect(resolveServerEnv({ ...VALID_RAW_ENV, NODE_ENV: 'test' }).nodeEnv).toBe('test');
    expect(resolveServerEnv({ ...VALID_RAW_ENV, NODE_ENV: 'staging' }).nodeEnv).toBe('development');
  });

  test('parses PRDM_SERVER_PORT and rejects out-of-range or non-integer values', () => {
    expect(resolveServerEnv({ ...VALID_RAW_ENV, PRDM_SERVER_PORT: '8080' }).serverPort).toBe(8080);
    for (const value of ['0', '65536', 'abc', '3.5', '-1']) {
      expect(() => resolveServerEnv({ ...VALID_RAW_ENV, PRDM_SERVER_PORT: value })).toThrow(ServerEnvError);
    }
  });

  test('requires PRDM_PUBLIC_URL to be a valid absolute URL', () => {
    const { PRDM_PUBLIC_URL: _omit, ...withoutPublicUrl } = VALID_RAW_ENV;
    expect(() => resolveServerEnv(withoutPublicUrl)).toThrow(/PRDM_PUBLIC_URL/);
    expect(() => resolveServerEnv({ ...VALID_RAW_ENV, PRDM_PUBLIC_URL: 'not-a-url' })).toThrow(/PRDM_PUBLIC_URL/);
  });

  test('requires BETTER_AUTH_SECRET to be at least 32 bytes', () => {
    expect(() => resolveServerEnv({ ...VALID_RAW_ENV, BETTER_AUTH_SECRET: 'a'.repeat(31) })).toThrow(/BETTER_AUTH_SECRET/);
    expect(resolveServerEnv({ ...VALID_RAW_ENV, BETTER_AUTH_SECRET: 'a'.repeat(32) }).betterAuthSecret).toHaveLength(32);
  });

  test('requires DATABASE_URL to be a postgres connection string', () => {
    expect(() => resolveServerEnv({ ...VALID_RAW_ENV, DATABASE_URL: 'mysql://x/y' })).toThrow(/DATABASE_URL/);
    expect(() => resolveServerEnv({ ...VALID_RAW_ENV, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  test('parses PRDM_TRUSTED_ORIGINS as a comma-separated list and rejects wildcards', () => {
    expect(resolveServerEnv({ ...VALID_RAW_ENV, PRDM_TRUSTED_ORIGINS: 'https://a.test, https://b.test' }).trustedOrigins).toEqual([
      'https://a.test',
      'https://b.test',
    ]);
    expect(() => resolveServerEnv({ ...VALID_RAW_ENV, PRDM_TRUSTED_ORIGINS: 'https://*.example.test' })).toThrow(/wildcard/);
    expect(() => resolveServerEnv({ ...VALID_RAW_ENV, PRDM_TRUSTED_ORIGINS: '' })).toThrow(ServerEnvError);
  });

  test('PRDM_TRUST_PROXY defaults to false and only accepts "0"/"1"', () => {
    expect(resolveServerEnv(VALID_RAW_ENV).trustProxy).toBe(false);
    expect(resolveServerEnv({ ...VALID_RAW_ENV, PRDM_TRUST_PROXY: '1' }).trustProxy).toBe(true);
    expect(resolveServerEnv({ ...VALID_RAW_ENV, PRDM_TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(() => resolveServerEnv({ ...VALID_RAW_ENV, PRDM_TRUST_PROXY: 'yes' })).toThrow(ServerEnvError);
  });

  test('requires SMTP_HOST, SMTP_PORT and SMTP_FROM', () => {
    const { SMTP_HOST: _h, ...withoutHost } = VALID_RAW_ENV;
    expect(() => resolveServerEnv(withoutHost)).toThrow(/SMTP_HOST/);
    expect(() => resolveServerEnv({ ...VALID_RAW_ENV, SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/);
    const { SMTP_FROM: _f, ...withoutFrom } = VALID_RAW_ENV;
    expect(() => resolveServerEnv(withoutFrom)).toThrow(/SMTP_FROM/);
  });

  test('requires NEO4J_PASSWORD; NEO4J_URI/USERNAME/DATABASE default to the local dev instance', () => {
    const { NEO4J_PASSWORD: _p, ...withoutPassword } = VALID_RAW_ENV;
    expect(() => resolveServerEnv(withoutPassword)).toThrow(/NEO4J_PASSWORD/);

    const env = resolveServerEnv({ ...VALID_RAW_ENV, NEO4J_URI: 'neo4j://graph.example.test:7687', NEO4J_USERNAME: 'app', NEO4J_DATABASE: 'prdm' });
    expect(env.neo4j).toEqual({ uri: 'neo4j://graph.example.test:7687', username: 'app', password: 'test-password', database: 'prdm' });
  });

  test('leaves deepseek undefined when DEEPSEEK_API_KEY is absent, populated when present', () => {
    expect(resolveServerEnv(VALID_RAW_ENV).deepseek).toBeUndefined();
    expect(resolveServerEnv({ ...VALID_RAW_ENV, DEEPSEEK_API_KEY: 'sk-test' }).deepseek).toEqual({
      apiKey: 'sk-test',
      baseUrl: undefined,
    });
  });

  test('collects every failing field into a single ServerEnvError message', () => {
    try {
      resolveServerEnv({});
      expect.unreachable('resolveServerEnv({}) must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ServerEnvError);
      const message = (err as Error).message;
      expect(message).toMatch(/PRDM_PUBLIC_URL/);
      expect(message).toMatch(/BETTER_AUTH_SECRET/);
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/PRDM_TRUSTED_ORIGINS/);
      expect(message).toMatch(/SMTP_HOST/);
    }
  });
});
