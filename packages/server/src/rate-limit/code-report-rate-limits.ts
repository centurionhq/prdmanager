/**
 * Per-token rate limit on `POST .../code-reports` (security review of WO-180/SDD-010, WO-259): the route
 * had a body-size cap (`MAX_CODE_REPORT_BODY_BYTES`) but nothing capping how many reports a single token
 * could push per minute, unlike the sibling `/mcp` surface's own per-token tool-call budget
 * (`./mcp-tool-rate-limits.ts`, which this mirrors). A well-behaved CI pipeline reports at most a
 * handful of times a minute (once per push, plus the occasional single retry); 30/minute per token
 * comfortably clears that while still bounding a leaked/misbehaving token hammering the endpoint —
 * baseline reports are the more expensive of the two modes (`PgProjectEngine.refresh()` against the
 * shared Neo4j, WO-261's own review point), so the same budget covers both without needing a second,
 * stricter tier.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

const ONE_MINUTE_MS = 60_000;

export const DEFAULT_CODE_REPORT_RATE_LIMIT_PER_MINUTE = 30;

export interface CodeReportRateLimitCheckResult {
  allowed: boolean;
  /** 0 when `allowed` is true. */
  retryAfterSeconds: number;
}

export interface CodeReportRateLimiter {
  check(req: FastifyRequest, tokenId: string): Promise<CodeReportRateLimitCheckResult>;
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

const tokenKeyByRequest = new WeakMap<FastifyRequest, string>();

/** Requires `@fastify/rate-limit` to already be registered on `app` (see `build-server.ts`). */
export function buildCodeReportRateLimiter(app: FastifyInstance, maxPerMinute = DEFAULT_CODE_REPORT_RATE_LIMIT_PER_MINUTE): CodeReportRateLimiter {
  const perToken = app.createRateLimit({
    max: maxPerMinute,
    timeWindow: ONE_MINUTE_MS,
    keyGenerator: (req) => `code-report:${tokenKeyByRequest.get(req) ?? ''}`,
  });

  return {
    async check(req, tokenId) {
      tokenKeyByRequest.set(req, tokenId);
      try {
        const result = await perToken(req);
        if (isExceeded(result)) return { allowed: false, retryAfterSeconds: retryAfterSeconds(result) };
        return { allowed: true, retryAfterSeconds: 0 };
      } finally {
        tokenKeyByRequest.delete(req);
      }
    },
  };
}
