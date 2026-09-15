/**
 * WO-227: Node's default `server.requestTimeout` is 5 minutes — too short for `.../agent/messages`'s
 * long-lived SSE connection once DeepSeek's real API is involved. A live verification against the real
 * key (never run in CI) found this account's model runs in "thinking mode" and can take several minutes
 * to produce even a trivial completion's first token, well past that default.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import { disableRequestTimeout } from '../../src/api/documents-agent.js';

describe('disableRequestTimeout', () => {
  test('disables the request timeout by calling setTimeout(0, callback) on the raw response', () => {
    const raw = { setTimeout: vi.fn() };
    disableRequestTimeout(raw);
    expect(raw.setTimeout).toHaveBeenCalledTimes(1);
    const [msecs, callback] = raw.setTimeout.mock.calls[0]!;
    expect(msecs).toBe(0);
    expect(typeof callback).toBe('function');
  });

  test('always passes a callback, even one that never gets invoked — light-my-request\'s test mock throws on undefined', () => {
    // Regression test: `light-my-request`'s `Response.setTimeout` does `this.on('timeout', callback)`
    // unconditionally, which throws `TypeError [ERR_INVALID_ARG_TYPE]` if `callback` is undefined —
    // exactly what happens under Fastify's `app.inject()` in every integration test for this route.
    const raw = { setTimeout: vi.fn((_msecs: number, callback: () => void) => new EventEmitter().on('timeout', callback)) };
    expect(() => disableRequestTimeout(raw)).not.toThrow();
  });

  test('is a no-op when the raw response has no setTimeout (structurally-typed, matches sendSseEvent)', () => {
    expect(() => disableRequestTimeout({})).not.toThrow();
  });
});
