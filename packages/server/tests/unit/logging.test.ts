import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { buildLoggerOptions, maskRequestUrl } from '../../src/logging.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const DEEPSEEK_SECRET = 'sk-deepseek-super-secret-value';
const BETTER_AUTH_SECRET = 'z'.repeat(40);
const DATABASE_URL_WITH_PASSWORD = 'postgres://prdm_app:hunter2-secret@127.0.0.1:55433/prdm';
const BEARER_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def';
const COOKIE_VALUE = 'better-auth.session_token=abc123def456';
const RESET_TOKEN = 'reset-token-should-never-appear';
const INVITE_SECRET = 'invite-fragment-secret-should-never-appear';

/** Collects every chunk written to it (pino's ndjson output) into `lines`, joined for substring assertions. */
function captureStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

describe('maskRequestUrl', () => {
  test('strips query strings from ordinary paths', () => {
    expect(maskRequestUrl('/api/health?foo=bar&baz=qux')).toBe('/api/health');
  });

  test('masks reset-password token paths entirely', () => {
    expect(maskRequestUrl('/api/auth/reset-password/abc123?x=1')).toBe('/api/auth/reset-password/[redacted]');
  });

  test('masks invite secret paths entirely', () => {
    expect(maskRequestUrl('/invite/inv_42?s=fragment-secret')).toBe('/invite/[redacted]');
  });
});

describe('buildLoggerOptions redaction (pino, no Fastify involved)', () => {
  test('redacts Authorization and Cookie headers wherever they appear', () => {
    const { stream, text } = captureStream();
    const logger = pino(buildLoggerOptions({ level: 'info' }), stream);

    logger.info({ headers: { authorization: BEARER_TOKEN, cookie: COOKIE_VALUE } }, 'inbound request');

    const output = text();
    expect(output).not.toContain(BEARER_TOKEN);
    expect(output).not.toContain(COOKIE_VALUE);
    expect(output).toContain('[redacted]');
  });

  test('redacts BETTER_AUTH_SECRET, DEEPSEEK_API_KEY and DATABASE_URL wherever nested under config', () => {
    const { stream, text } = captureStream();
    const logger = pino(buildLoggerOptions({ level: 'info' }), stream);

    logger.info({ config: { BETTER_AUTH_SECRET, DEEPSEEK_API_KEY: DEEPSEEK_SECRET, DATABASE_URL: DATABASE_URL_WITH_PASSWORD } }, 'boot');

    const output = text();
    expect(output).not.toContain(BETTER_AUTH_SECRET);
    expect(output).not.toContain(DEEPSEEK_SECRET);
    expect(output).not.toContain(DATABASE_URL_WITH_PASSWORD);
  });

  test('redacts fields named token/password/secret at any nesting depth', () => {
    const { stream, text } = captureStream();
    const logger = pino(buildLoggerOptions({ level: 'info' }), stream);

    logger.info({ reset: { token: RESET_TOKEN }, invite: { secret: INVITE_SECRET } }, 'issued');

    const output = text();
    expect(output).not.toContain(RESET_TOKEN);
    expect(output).not.toContain(INVITE_SECRET);
  });
});

describe('buildServer request logging never leaks secrets', () => {
  test('captured access logs mask reset-password/invite URLs, strip query strings, and never contain header secrets', async () => {
    const { stream, text } = captureStream();
    const app = buildServer({ env: buildTestServerEnv(), logger: { level: 'info', stream } });

    await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: BEARER_TOKEN, cookie: COOKIE_VALUE },
    });
    await app.inject({ method: 'GET', url: `/api/auth/reset-password/${RESET_TOKEN}` });
    await app.inject({ method: 'GET', url: `/invite/inv_1?s=${INVITE_SECRET}` });
    app.log.info({ config: { BETTER_AUTH_SECRET, DEEPSEEK_API_KEY: DEEPSEEK_SECRET } }, 'boot');
    await app.close();

    const output = text();
    expect(output).not.toContain(BEARER_TOKEN);
    expect(output).not.toContain(COOKIE_VALUE);
    expect(output).not.toContain(RESET_TOKEN);
    expect(output).not.toContain(INVITE_SECRET);
    expect(output).not.toContain(BETTER_AUTH_SECRET);
    expect(output).not.toContain(DEEPSEEK_SECRET);
    expect(output).toContain('/api/auth/reset-password/[redacted]');
    expect(output).toContain('/invite/[redacted]');
  });
});
