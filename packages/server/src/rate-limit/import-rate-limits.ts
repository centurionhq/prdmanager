/**
 * Per-token rate limit on `POST .../import` (security review of WO-192/SDD-010, WO-259): the route had a
 * body-size cap (`MAX_IMPORT_BODY_BYTES`) but nothing capping how many times a token could hit this
 * (relatively expensive — full re-parse/re-validate of an entire repository's `docs/`) endpoint per
 * minute. Same `@fastify/rate-limit` mechanism as `./mcp-tool-rate-limits.ts` (`app.createRateLimit`,
 * `WeakMap<FastifyRequest, string>` keying since `keyGenerator` only ever receives the request itself).
 *
 * A legitimate import is a one-time bootstrap that only ever succeeds once per project (the second
 * attempt is always a `409` — see `code-reports.ts`'s sibling module doc comment on `ProjectNotEmptyError`)
 * — 10/minute per token comfortably covers a client iterating on a rejected payload while still bounding
 * abuse of a leaked token.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

const ONE_MINUTE_MS = 60_000;

export const DEFAULT_IMPORT_RATE_LIMIT_PER_MINUTE = 10;

export interface ImportRateLimitCheckResult {
  allowed: boolean;
  /** 0 when `allowed` is true. */
  retryAfterSeconds: number;
}

export interface ImportRateLimiter {
  check(req: FastifyRequest, tokenId: string): Promise<ImportRateLimitCheckResult>;
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
export function buildImportRateLimiter(app: FastifyInstance, maxPerMinute = DEFAULT_IMPORT_RATE_LIMIT_PER_MINUTE): ImportRateLimiter {
  const perToken = app.createRateLimit({
    max: maxPerMinute,
    timeWindow: ONE_MINUTE_MS,
    keyGenerator: (req) => `import:${tokenKeyByRequest.get(req) ?? ''}`,
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
