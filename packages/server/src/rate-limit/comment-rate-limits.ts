/**
 * Per-user and per-document volume limits on comment thread/reply creation (SDD-008 §"Comentarios",
 * security review #2, WO-219): `@prdm/contracts`'s `createCommentThreadInputSchema`/
 * `replyToCommentThreadInputSchema` already cap how *big* a single comment body can be (≤ 10 KB), but
 * nothing capped how *many* a caller could fire per minute — unlike `/collab`'s own live-edit update-rate
 * limits (`../collab/limits.ts`, 30/s per user and 100/s per document), which exist for exactly this
 * class of volume abuse on the sibling real-time path.
 *
 * Uses the same `@fastify/rate-limit` mechanism already in this codebase (`app.createRateLimit`, checked
 * manually inside the route handler — see `./auth-rate-limits.ts`/`./invitation-rate-limits.ts`) rather
 * than inventing a new limiting mechanism, keyed by a `WeakMap<FastifyRequest, string>` the same way
 * `./keyed-rate-limit.ts`'s own account dimension is, since `@fastify/rate-limit`'s `keyGenerator` only
 * ever receives the request itself.
 *
 * 20/minute per user and 60/minute per document: a real, focused review conversation runs at a few
 * comments a minute at most (SDD-008 gives no explicit number), so both limits comfortably clear
 * legitimate use while still capping the "dozens of comments per minute" abuse case the security review
 * called out. The per-document ceiling is higher than the per-user one on purpose — several editors can
 * legitimately be commenting on the same actively-reviewed document at once.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

const ONE_MINUTE_MS = 60_000;

export const COMMENT_RATE_LIMIT_CONFIG = {
  maxPerUserPerMinute: 20,
  maxPerDocumentPerMinute: 60,
} as const;

export interface CommentRateLimitCheckResult {
  allowed: boolean;
  /** 0 when `allowed` is true. */
  retryAfterSeconds: number;
}

export interface CommentRateLimiter {
  /** Checks and increments the per-user counter, then the per-document one — both count as an attempt
   * whether or not the request ends up succeeding, same reasoning as `./keyed-rate-limit.ts`'s own
   * dual-dimension check. */
  check(req: FastifyRequest, params: { userId: string; documentId: string }): Promise<CommentRateLimitCheckResult>;
}

/** `@fastify/rate-limit`'s own return shape sets `isAllowed: false` even for a request *within* its
 * limit; `isExceeded` is the field that actually distinguishes "counted, still fine" from "over the
 * limit" — see `./keyed-rate-limit.ts`'s own note on the same plugin behavior. */
function isExceeded(result: { isExceeded?: boolean; [key: string]: unknown }): boolean {
  return result.isExceeded === true;
}

function retryAfterSeconds(result: { ttlInSeconds?: number; [key: string]: unknown }): number {
  return ('ttlInSeconds' in result && result.ttlInSeconds) || 0;
}

const userKeyByRequest = new WeakMap<FastifyRequest, string>();
const documentKeyByRequest = new WeakMap<FastifyRequest, string>();

/** Requires `@fastify/rate-limit` to already be registered on `app` (see `build-server.ts`). */
export function buildCommentRateLimiter(app: FastifyInstance): CommentRateLimiter {
  const perUser = app.createRateLimit({
    max: COMMENT_RATE_LIMIT_CONFIG.maxPerUserPerMinute,
    timeWindow: ONE_MINUTE_MS,
    keyGenerator: (req) => `comment-user:${userKeyByRequest.get(req) ?? ''}`,
  });
  const perDocument = app.createRateLimit({
    max: COMMENT_RATE_LIMIT_CONFIG.maxPerDocumentPerMinute,
    timeWindow: ONE_MINUTE_MS,
    keyGenerator: (req) => `comment-doc:${documentKeyByRequest.get(req) ?? ''}`,
  });

  return {
    async check(req, { userId, documentId }) {
      userKeyByRequest.set(req, userId);
      documentKeyByRequest.set(req, documentId);
      try {
        const userResult = await perUser(req);
        if (isExceeded(userResult)) return { allowed: false, retryAfterSeconds: retryAfterSeconds(userResult) };

        const documentResult = await perDocument(req);
        if (isExceeded(documentResult)) return { allowed: false, retryAfterSeconds: retryAfterSeconds(documentResult) };

        return { allowed: true, retryAfterSeconds: 0 };
      } finally {
        userKeyByRequest.delete(req);
        documentKeyByRequest.delete(req);
      }
    },
  };
}
