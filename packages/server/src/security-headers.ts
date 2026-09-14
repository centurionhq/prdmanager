/**
 * Security response headers for every `packages/server` response (SDD-006 §Cabeceras, CSRF y logs,
 * WO-108). Deliberately separate from `packages/web/src/security-headers.ts` (PRD-004's loopback-only
 * project explorer, no auth, `GET`-only) even though the baseline CSP is the same shape: this server is
 * a multi-tenant SaaS surface with sessions, cookies and a websocket collab channel (SDD-008), so its
 * `connect-src` needs the exact public `wss://` origin and its `style-src` needs a per-request nonce
 * (for CodeMirror, SDD-008) instead of PRD-004's blanket `'unsafe-inline'` — two independently deployed
 * servers with different threat models, not a shared config.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ServerEnv } from './env.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Fresh per request (SDD-006 §Cabeceras: "nonce de estilo"); a future HTML shell (SDD-006
     * §Dashboard) reads this to emit `<style nonce="...">`/inline `style` attributes that match the
     * `style-src` this module sets on the same response. */
    cspNonce: string;
  }
}

/** `wss://<host>` in production (or whenever `PRDM_PUBLIC_URL` is `https:`), `ws://<host>` for local
 * http dev — always the exact public host, never a bare `wss:`/`ws:` scheme (SDD-006 §Cabeceras: "nunca
 * wss suelto"), since the collab websocket (SDD-008) is served from this same origin. */
export function websocketConnectSrc(publicUrl: string): string {
  const url = new URL(publicUrl);
  const scheme = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${url.host}`;
}

export function buildContentSecurityPolicy(env: ServerEnv, nonce: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // No 'unsafe-inline': until packages/app ships, nothing needs it; the nonce is already wired for
    // when it does (SDD-006 §Cabeceras: "nonce de estilo para CodeMirror en lugar de 'unsafe-inline'").
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    `connect-src 'self' ${websocketConnectSrc(env.publicUrl)}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Applied to every response regardless of route (health check, 404s, `/api/app/*`, ...) — registered
 * unconditionally in `build-server.ts`, not gated behind `pool && mailer` like the auth-backed routes,
 * since even an unauthenticated 404 should carry these headers.
 */
export function registerSecurityHeaders(app: FastifyInstance, env: ServerEnv): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    req.cspNonce = generateNonce();
  });

  app.addHook('onSend', async (req: FastifyRequest, reply, payload) => {
    reply.header('Content-Security-Policy', buildContentSecurityPolicy(env, req.cspNonce));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    // HSTS only in production (SDD-006 §Local y despliegue: dev/test never run over TLS, so an HSTS
    // header there would just be misleading — matching PRD-004's own reasoning, applied here per-env
    // rather than unconditionally).
    if (env.nodeEnv === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    return payload;
  });
}
