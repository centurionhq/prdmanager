/**
 * Fastify/pino logging configuration (SDD-006 §Cabeceras, CSRF y logs, WO-091): secrets must never
 * reach a log line. Two complementary mechanisms:
 *  - `redact`: pino's own path-based redaction for known-sensitive header/config keys.
 *  - `serializers.req`: a custom request serializer that masks `/reset-password/*` and `/invite/*`
 *    paths outright and strips every query string, since a reset token or invitation secret can
 *    otherwise leak through the URL itself (query strings, not just headers).
 */
import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import pino from 'pino';

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

/**
 * WO-248 (performance/security review, LOW/preventive): `REDACT_PATHS`'s `*.token`/`*.secret`/etc. entries
 * only match ONE wildcard segment (`*.token` matches `a.token`, not `a.b.token`) — empirically confirmed
 * against the installed `@pinojs/redact` engine despite its own README claiming an intermediate wildcard
 * "redacts at any level". A caught `Error` can carry arbitrary own properties from whatever threw it (an
 * HTTP client library commonly attaches `err.config`/`err.response` carrying the original request's
 * headers, for exactly the DeepSeek API calls this server makes) — `pino.stdSerializers.err` preserves
 * those properties verbatim, so `err.config.headers.authorization` (two wildcard segments deep) would
 * reach a log line unredacted with only the path-based mechanism above.
 *
 * `deepRedactSecrets` is a second, independent layer: it walks a value recursively (bounded depth against
 * pathological/circular input) and blanks any plain-object key whose *name* matches a known secret key,
 * regardless of how deep it sits — applied only to the `err` serializer's output below, since that's the
 * one place this codebase logs an object whose full shape isn't controlled by this codebase's own code.
 */
const SECRET_KEY_NAMES = new Set(
  ['authorization', 'cookie', 'set-cookie', 'password', 'secret', 'token', 'apikey', 'betterauthsecret', 'better_auth_secret', 'deepseek_api_key', 'database_url', 'smtp_pass'].map((name) =>
    name.toLowerCase(),
  ),
);

const DEEP_REDACT_MAX_DEPTH = 8;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepRedactSecrets(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (depth >= DEEP_REDACT_MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    return value.map((entry) => deepRedactSecrets(entry, depth + 1, seen));
  }
  if (!isPlainRecord(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SECRET_KEY_NAMES.has(key.toLowerCase()) ? REDACT_CENSOR : deepRedactSecrets(entry, depth + 1, seen);
  }
  return result;
}

/** Wraps pino's own default `err` serializer (which safely extracts `type`/`message`/`stack` from an
 * arbitrary thrown value) with the recursive pass above. */
function errSerializer(err: unknown): unknown {
  return deepRedactSecrets(pino.stdSerializers.err(err as Error));
}

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
    serializers: { req: reqSerializer, err: errSerializer, ...serializers },
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
