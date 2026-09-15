/**
 * A `@fastify/rate-limit` store backed by an injectable clock (SDD-006 §Autenticación, WO-095):
 * production wiring never passes `clock`, matching the plugin's own `LocalStore` (real wall time);
 * tests inject a fake clock so a limit's window can be "advanced" deterministically with no `sleep`.
 *
 * `@fastify/rate-limit` instantiates whatever class is passed as `store` with `new Store(options)`
 * (see its own `index.js`), so there's no constructor parameter to thread a clock through — hence a
 * factory that returns a *new class per clock*, capturing it in a closure instead.
 */
import type { FastifyRateLimitOptions, FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';

interface Bucket {
  count: number;
  resetAt: number;
}

export function createClockStore(clock: () => Date): FastifyRateLimitStoreCtor {
  return class ClockStore implements FastifyRateLimitStore {
    private readonly buckets = new Map<string, Bucket>();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- constructor shape required by FastifyRateLimitStoreCtor.
    constructor(_options: FastifyRateLimitOptions) {}

    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number,
      _max: number,
    ): void {
      const now = clock().getTime();
      let bucket = this.buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + timeWindow };
        this.buckets.set(key, bucket);
      }
      bucket.count += 1;
      callback(null, { current: bucket.count, ttl: Math.max(0, bucket.resetAt - now) });
    }

    child(): FastifyRateLimitStore {
      return new (createClockStore(clock))({});
    }
  };
}
