import Fastify from 'fastify';
import rateLimitPlugin from '@fastify/rate-limit';
import { describe, expect, test } from 'vitest';
import { createClockStore } from '../../src/rate-limit/clock-store.js';
import { createKeyedRateLimiter } from '../../src/rate-limit/keyed-rate-limit.js';

/** A mutable fake clock: tests advance `current` directly instead of sleeping. */
function fakeClock(startMs = 0) {
  let current = startMs;
  return { now: () => new Date(current), advance: (ms: number) => (current += ms) };
}

async function buildTestApp(clockNow: () => Date) {
  const app = Fastify({ logger: false });
  await app.register(rateLimitPlugin, { global: false, store: createClockStore(clockNow) });
  return app;
}

describe('createKeyedRateLimiter (unit, no Postgres)', () => {
  test('allows up to max attempts per IP, then blocks, independent of any account key', async () => {
    const clock = fakeClock();
    const app = await buildTestApp(clock.now);
    const limiter = createKeyedRateLimiter(app, { max: 3, timeWindowMs: 1000 });
    app.post('/probe', async (req) => limiter.check(req, undefined));

    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/probe' });
      expect(res.json()).toMatchObject({ allowed: true });
    }
    const fourth = await app.inject({ method: 'POST', url: '/probe' });
    expect(fourth.json()).toMatchObject({ allowed: false });

    await app.close();
  });

  test('blocks by account key even when different IPs are used, once that account is over its limit', async () => {
    const clock = fakeClock();
    const app = await buildTestApp(clock.now);
    const limiter = createKeyedRateLimiter(app, { max: 2, timeWindowMs: 1000 });
    app.post('/probe', async (req) => limiter.check(req, 'someone@example.test'));

    await app.inject({ method: 'POST', url: '/probe', remoteAddress: '10.0.0.1' });
    await app.inject({ method: 'POST', url: '/probe', remoteAddress: '10.0.0.2' });
    const third = await app.inject({ method: 'POST', url: '/probe', remoteAddress: '10.0.0.3' });

    expect(third.json()).toMatchObject({ allowed: false });

    await app.close();
  });

  test('a request with no account key is only ever limited by IP', async () => {
    const clock = fakeClock();
    const app = await buildTestApp(clock.now);
    const limiter = createKeyedRateLimiter(app, { max: 1, timeWindowMs: 1000 });
    app.post('/probe', async (req, reply) => {
      const accountKey = (req.query as { account?: string }).account;
      return limiter.check(req, accountKey);
    });

    const first = await app.inject({ method: 'POST', url: '/probe' });
    expect(first.json()).toMatchObject({ allowed: true });
    // Same IP, no account key on this second call either -> IP counter (shared with the first call) is
    // already exhausted, so this must be blocked regardless of any account dimension.
    const second = await app.inject({ method: 'POST', url: '/probe' });
    expect(second.json()).toMatchObject({ allowed: false });

    await app.close();
  });

  test('recovers after the fake clock advances past the time window', async () => {
    const clock = fakeClock();
    const app = await buildTestApp(clock.now);
    const limiter = createKeyedRateLimiter(app, { max: 1, timeWindowMs: 1000 });
    app.post('/probe', async (req) => limiter.check(req, undefined));

    await app.inject({ method: 'POST', url: '/probe' });
    const blocked = await app.inject({ method: 'POST', url: '/probe' });
    expect(blocked.json()).toMatchObject({ allowed: false });

    clock.advance(1001);

    const afterWindow = await app.inject({ method: 'POST', url: '/probe' });
    expect(afterWindow.json()).toMatchObject({ allowed: true });

    await app.close();
  });
});
