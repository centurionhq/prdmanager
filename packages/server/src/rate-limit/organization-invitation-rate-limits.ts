/**
 * Rate limit for issuing an organization invitation link — creating a fresh one
 * (`POST .../invitations`) or resending/rotating an existing one's secret
 * (`POST .../invitations/:invitationId/resend`, WO-343) share this exact limiter: both ultimately email a
 * fresh one-time accept link, so both should cost the same against the same budget rather than resend
 * being an unbounded way around create's own limit.
 */
import type { FastifyInstance } from 'fastify';
import { createKeyedRateLimiter, type KeyedRateLimiter } from './keyed-rate-limit.js';

const FIFTEEN_MINUTES_MS = 15 * 60_000;

export function buildOrganizationInvitationRateLimiter(app: FastifyInstance): KeyedRateLimiter {
  return createKeyedRateLimiter(app, { max: 10, timeWindowMs: FIFTEEN_MINUTES_MS });
}
