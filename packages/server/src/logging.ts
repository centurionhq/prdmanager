/**
 * Fastify/pino logging configuration (SDD-006 §Cabeceras, CSRF y logs, WO-091): secrets must never
 * reach a log line. Two complementary mechanisms:
 *  - `redact`: pino's own path-based redaction for known-sensitive header/config keys.
 *  - `serializers.req`: a custom request serializer that masks `/reset-password/*` and `/invite/*`
 *    paths outright and strips every query string, since a reset token or invitation secret can
 *    otherwise leak through the URL itself (query strings, not just headers).
 */
import type { FastifyRequest, FastifyServerOptions } from 'fastify';

/** Pino dot/bracket paths redacted wherever they appear in a logged object. */
export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.betterAuthSecret',
  '*.BETTER_AUTH_SECRET',
  '*.DEEPSEEK_API_KEY',
  '*.DATABASE_URL',
  '*.SMTP_PASS',
];

const REDACT_CENSOR = '[redacted]';

/** Path prefixes whose entire pathname is replaced (SDD-006 §Cabeceras): the segment after the
 * prefix can itself be a one-time secret (reset token, invitation id) that must never reach a log. */
const MASKED_PATH_PREFIXES = ['/api/auth/reset-password/', '/reset-password/', '/invite/'];

/** Strips the query string unconditionally and masks known-sensitive path prefixes. */
export function maskRequestUrl(rawUrl: string): string {
  const pathname = rawUrl.split('?')[0] ?? rawUrl;
  for (const prefix of MASKED_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return `${prefix}[redacted]`;
  }
  return pathname;
}

export interface SerializedRequest {
  method: string;
  url: string;
  hostname: string;
  remoteAddress?: string;
}

export function reqSerializer(req: FastifyRequest): SerializedRequest {
  return {
    method: req.method,
    url: maskRequestUrl(req.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
  };
}

/**
 * Builds the pino options object used by both `buildServer`'s Fastify logger and (later, SDD-006
 * §Autenticación: "better-auth usa el mismo logger") better-auth's own logger sink. `overrides` lets
 * tests inject a `stream`/`level` while keeping the same redaction and serializers.
 */
export function buildLoggerOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { serializers, ...restOverrides } = overrides as Record<string, unknown> & { serializers?: Record<string, unknown> };
  return {
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    ...restOverrides,
    serializers: { req: reqSerializer, ...serializers },
  };
}

/** Merges caller-supplied logger options with the mandatory redaction/serializers so a test that
 * only wants to override `level`/`stream` can never accidentally disable secret redaction. */
export function resolveLoggerOption(logger: FastifyServerOptions['logger']): FastifyServerOptions['logger'] {
  if (logger === false) return false;
  if (logger === undefined || logger === true) return buildLoggerOptions({ level: 'info' });
  if (typeof logger === 'object') {
    return buildLoggerOptions(logger as Record<string, unknown>) as FastifyServerOptions['logger'];
  }
  return logger;
}
