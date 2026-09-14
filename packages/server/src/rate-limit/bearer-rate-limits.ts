/**
 * Rate limit for failed Bearer authentication attempts (SDD-006 §Autenticación: "Rate limit: ...
 * autenticación Bearer fallida", WO-109) — the same per-IP keyed limiter primitive every other
 * SDD-006 rate limit uses (`./keyed-rate-limit.js`). Only ever checked on a failure (missing/malformed
 * header, corrupted checksum, unknown/expired/revoked token, or a cookie riding along on a Bearer
 * route) — a successful Bearer request never counts against this budget.
 */
import type { FastifyInstance } from 'fastify';
import { createKeyedRateLimiter, type KeyedRateLimiter } from './keyed-rate-limit.js';

const FIFTEEN_MINUTES_MS = 15 * 60_000;

export function buildBearerAuthRateLimiter(app: FastifyInstance): KeyedRateLimiter {
  return createKeyedRateLimiter(app, { max: 20, timeWindowMs: FIFTEEN_MINUTES_MS });
}
