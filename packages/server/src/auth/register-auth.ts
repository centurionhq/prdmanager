/**
 * Mounts better-auth on `/api/auth/*` behind the SDD-006 allowlist (WO-093): everything not in
 * `AUTH_ALLOWED_PATHS` 404s with the shared error envelope before ever reaching `auth.handler`.
 */
import { errorEnvelope } from '@prdm/contracts';
import type { FastifyInstance } from 'fastify';
import type { ServerEnv } from '../env.js';
import { isAllowedAuthPath } from './allowlist.js';
import type { Auth } from './build-auth.js';
import { sendFetchResponse, toFetchRequest } from './to-fetch-request.js';

export const AUTH_PREFIX = '/api/auth';

export interface RegisterAuthOptions {
  auth: Auth;
  env: ServerEnv;
}

function stripAuthPrefix(url: string): string {
  const withoutPrefix = url.startsWith(AUTH_PREFIX) ? url.slice(AUTH_PREFIX.length) : url;
  const pathname = withoutPrefix.split('?')[0];
  return pathname && pathname.length > 0 ? pathname : '/';
}

/** Registered directly on `app` (like `registerHealthRoute`), not as an encapsulated Fastify
 * plugin: `/api/auth/*` needs no isolated context, and a plain route stays synchronously ready. */
export function registerAuth(app: FastifyInstance, opts: RegisterAuthOptions): void {
  const { auth, env } = opts;

  app.all(`${AUTH_PREFIX}/*`, async (req, reply) => {
    const pathname = stripAuthPrefix(req.url);
    if (!isAllowedAuthPath(pathname)) {
      reply.code(404).send(errorEnvelope('not_found', 'route not found'));
      return;
    }
    const request = toFetchRequest(req, env.publicUrl);
    const response = await auth.handler(request);
    await sendFetchResponse(response, reply);
  });
}
