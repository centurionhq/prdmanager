import type { FastifyInstance } from 'fastify';

/**
 * SDD-005 "Seguridad": applied to every response, API and static bundle alike. Vite's dev server never goes
 * through this process (it proxies `/api` the other way and serves the SPA itself), so there is no separate
 * "dev" CSP to reconcile here — this Fastify process only ever serves the built, hashed production bundle.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
}
