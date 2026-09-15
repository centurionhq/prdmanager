/**
 * `onRequest` hook rejecting any `/api/auth/*` request whose `Host` doesn't match `PRDM_PUBLIC_URL`
 * (SDD-006 §Autenticación, WO-094): defense in depth on top of `to-fetch-request.ts` already building
 * the internal URL from the fixed public origin regardless of `Host`. `X-Forwarded-Host` is consulted
 * only when `PRDM_TRUST_PROXY=1` — otherwise it's just an attacker-controlled header and is ignored
 * entirely, exactly like `@fastify/rate-limit`'s own IP resolution (`env.trustProxy` gates both).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorEnvelope } from '@prdm/contracts';
import type { ServerEnv } from '../env.js';

export function expectedAuthHost(publicUrl: string): string {
  return new URL(publicUrl).host;
}

/** Pure resolution of "which Host does this request claim to be for", given the same trust rule the
 * rest of the server uses for proxy headers — exported so it can be unit-tested without Fastify. */
export function resolveRequestHost(
  headers: Partial<Pick<FastifyRequest['headers'], 'host' | 'x-forwarded-host'>>,
  trustProxy: boolean,
): string | undefined {
  if (trustProxy) {
    const forwarded = headers['x-forwarded-host'];
    const forwardedHost = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof forwardedHost === 'string' && forwardedHost.length > 0) {
      return forwardedHost.split(',')[0]!.trim();
    }
  }
  return headers.host;
}

export function createHostGuardHook(env: ServerEnv) {
  const expected = expectedAuthHost(env.publicUrl);
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const resolved = resolveRequestHost(req.headers, env.trustProxy);
    if (resolved !== expected) {
      reply.code(404).send(errorEnvelope('not_found', 'route not found'));
    }
  };
}
