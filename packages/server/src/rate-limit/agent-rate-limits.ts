/**
 * Per-user request rate limit on `POST .../agent/messages` (SDD-009 §Seguridad y costo:
 * "rate limit por usuario (PRDM_AGENT_RPM_PER_USER); excedido devuelve 429 rate_limited"; WO-175).
 *
 * Same `@fastify/rate-limit` mechanism as `./comment-rate-limits.ts` (`app.createRateLimit`, keyed by a
 * `WeakMap<FastifyRequest, string>` since `keyGenerator` only ever receives the request itself) — kept as
 * its own small module rather than folding into the comment limiter since it has only one dimension
 * (no per-document counterpart: SDD-009 doesn't call for one) and a configurable limit
 * (`env.agentQuotas.rpmPerUser`), unlike the comment limiter's fixed constants.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

const ONE_MINUTE_MS = 60_000;

export interface AgentRateLimitCheckResult {
  allowed: boolean;
  /** 0 when `allowed` is true. */
  retryAfterSeconds: number;
}

export interface AgentRateLimiter {
  check(req: FastifyRequest, userId: string): Promise<AgentRateLimitCheckResult>;
}

/** `@fastify/rate-limit`'s own return shape sets `isAllowed: false` even for a request *within* its
 * limit; `isExceeded` is the field that actually distinguishes "counted, still fine" from "over the
 * limit" — see `./comment-rate-limits.ts`'s own note on the same plugin behavior. */
function isExceeded(result: { isExceeded?: boolean; [key: string]: unknown }): boolean {
  return result.isExceeded === true;
}

function retryAfterSeconds(result: { ttlInSeconds?: number; [key: string]: unknown }): number {
  return ('ttlInSeconds' in result && result.ttlInSeconds) || 0;
}

const userKeyByRequest = new WeakMap<FastifyRequest, string>();

/** Requires `@fastify/rate-limit` to already be registered on `app` (see `build-server.ts`). */
export function buildAgentRateLimiter(app: FastifyInstance, rpmPerUser: number): AgentRateLimiter {
  const perUser = app.createRateLimit({
    max: rpmPerUser,
    timeWindow: ONE_MINUTE_MS,
    keyGenerator: (req) => `agent-user:${userKeyByRequest.get(req) ?? ''}`,
  });

  return {
    async check(req, userId) {
      userKeyByRequest.set(req, userId);
      try {
        const result = await perUser(req);
        if (isExceeded(result)) return { allowed: false, retryAfterSeconds: retryAfterSeconds(result) };
        return { allowed: true, retryAfterSeconds: 0 };
      } finally {
        userKeyByRequest.delete(req);
      }
    },
  };
}
