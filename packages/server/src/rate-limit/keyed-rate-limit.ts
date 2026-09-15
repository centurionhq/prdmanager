/**
 * Per-IP-and-per-account rate limiting (SDD-006 §Autenticación, WO-095): sign-in, password reset,
 * change-password, invitation accept (route not mounted yet — this helper is exported for whichever
 * later WO adds it) and failed Bearer auth (exported for WO-109) all share this one keyed helper
 * rather than each hand-rolling limiter logic.
 *
 * Requires `@fastify/rate-limit` to already be registered on `app` via `./register-rate-limit.js`
 * (that's what makes `app.createRateLimit` exist). Each call to `createKeyedRateLimiter` gets its own
 * independent counters (`@fastify/rate-limit` gives every `createRateLimit()` call a `store.child()`),
 * so different actions never share a bucket even with the same IP/account.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface RateLimitCheckResult {
  allowed: boolean;
  /** 0 when `allowed` is true. */
  retryAfterSeconds: number;
}

export interface KeyedRateLimiter {
  /** Checks and increments the IP counter, then (only if `accountKey` is given) the account counter.
   * Both requests count as an attempt whether or not the caller ends up succeeding — matching brute
   * force throttling for sign-in/reset/change-password; a later WO may call this only on a Bearer
   * auth *failure* instead, which this same primitive supports (call it only where a failure is
   * already known to have happened). */
  check(req: FastifyRequest, accountKey: string | undefined): Promise<RateLimitCheckResult>;
}

export interface CreateKeyedRateLimiterOptions {
  max: number;
  timeWindowMs: number;
}

/** `@fastify/rate-limit`'s own return shape sets `isAllowed: false` even for a request *within* its
 * limit (only the allowList short-circuit ever sets `isAllowed: true`); `isExceeded` is the field
 * that actually distinguishes "counted, still fine" from "over the limit" — see its `index.js`. */
function isExceeded(result: { isExceeded?: boolean; [key: string]: unknown }): boolean {
  return result.isExceeded === true;
}

const accountKeyByRequest = new WeakMap<FastifyRequest, string>();

export function createKeyedRateLimiter(app: FastifyInstance, opts: CreateKeyedRateLimiterOptions): KeyedRateLimiter {
  const ipLimiter = app.createRateLimit({
    max: opts.max,
    timeWindow: opts.timeWindowMs,
    keyGenerator: (req) => `ip:${req.ip}`,
  });
  const accountLimiter = app.createRateLimit({
    max: opts.max,
    timeWindow: opts.timeWindowMs,
    keyGenerator: (req) => `account:${accountKeyByRequest.get(req) ?? ''}`,
  });

  return {
    async check(req: FastifyRequest, accountKey: string | undefined): Promise<RateLimitCheckResult> {
      const ipResult = await ipLimiter(req);
      if (isExceeded(ipResult)) return { allowed: false, retryAfterSeconds: ('ttlInSeconds' in ipResult && ipResult.ttlInSeconds) || 0 };

      if (accountKey) {
        accountKeyByRequest.set(req, accountKey);
        try {
          const accountResult = await accountLimiter(req);
          if (isExceeded(accountResult)) {
            return { allowed: false, retryAfterSeconds: ('ttlInSeconds' in accountResult && accountResult.ttlInSeconds) || 0 };
          }
        } finally {
          accountKeyByRequest.delete(req);
        }
      }

      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
