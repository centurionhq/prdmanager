/**
 * Which `/api/auth/*` allowlisted paths are rate-limited, and how each one's "account" dimension is
 * derived (SDD-006 §Autenticación, WO-095). `/change-password` has no email in its body — its account
 * dimension is the caller's own session cookie, which is enough to distinguish "which already
 * authenticated party is hammering this endpoint" without an extra session lookup.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createKeyedRateLimiter, type KeyedRateLimiter } from './keyed-rate-limit.js';

const FIFTEEN_MINUTES_MS = 15 * 60_000;

export const AUTH_RATE_LIMIT_CONFIG = {
  '/sign-in/email': { max: 5, timeWindowMs: FIFTEEN_MINUTES_MS },
  '/request-password-reset': { max: 5, timeWindowMs: FIFTEEN_MINUTES_MS },
  '/change-password': { max: 5, timeWindowMs: FIFTEEN_MINUTES_MS },
} as const satisfies Record<string, { max: number; timeWindowMs: number }>;

export type RateLimitedAuthPath = keyof typeof AUTH_RATE_LIMIT_CONFIG;

export type AuthRateLimiters = Record<RateLimitedAuthPath, KeyedRateLimiter>;

export function isRateLimitedAuthPath(pathname: string): pathname is RateLimitedAuthPath {
  return Object.prototype.hasOwnProperty.call(AUTH_RATE_LIMIT_CONFIG, pathname);
}

/** Requires `@fastify/rate-limit` to already be registered on `app` (see `build-server.ts`). */
export function buildAuthRateLimiters(app: FastifyInstance): AuthRateLimiters {
  const entries = (Object.keys(AUTH_RATE_LIMIT_CONFIG) as RateLimitedAuthPath[]).map(
    (path) => [path, createKeyedRateLimiter(app, AUTH_RATE_LIMIT_CONFIG[path])] as const,
  );
  return Object.fromEntries(entries) as AuthRateLimiters;
}

export function resolveAuthRateLimitAccountKey(pathname: RateLimitedAuthPath, req: FastifyRequest): string | undefined {
  if (pathname === '/sign-in/email' || pathname === '/request-password-reset') {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' && email.length > 0 ? email.trim().toLowerCase() : undefined;
  }
  const cookie = req.headers.cookie;
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : undefined;
}
