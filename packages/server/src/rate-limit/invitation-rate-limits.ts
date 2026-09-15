/**
 * Rate limit for invitation acceptance (SDD-006 §Autenticación, WO-105) — the same per-IP/per-account
 * keyed limiter used for `/api/auth/*`'s sign-in/reset/change-password (`./auth-rate-limits.ts`), sized
 * the same order of magnitude: an invitation secret is high-entropy, but this still caps how many
 * guesses (wrong secret, or a password too short) a given IP/email can throw at the endpoint.
 */
import type { FastifyInstance } from 'fastify';
import { createKeyedRateLimiter, type KeyedRateLimiter } from './keyed-rate-limit.js';

const FIFTEEN_MINUTES_MS = 15 * 60_000;

export function buildInvitationAcceptRateLimiter(app: FastifyInstance): KeyedRateLimiter {
  return createKeyedRateLimiter(app, { max: 10, timeWindowMs: FIFTEEN_MINUTES_MS });
}
