/**
 * Origin defense-in-depth check for Bearer routes (SDD-010, WO-184/WO-249): every Bearer route already
 * rejects a request that carries a cookie (`requireBearerToken`), so none of them are actually reachable
 * via a browser's ambient-credential CSRF pattern in the first place — this check exists purely as a
 * courtesy second layer for a browser-originated request that happens to carry an `Origin` header anyway
 * (SDD-010's own reasoning for `mcp-remote.ts`, which introduced it first).
 *
 * A missing `Origin` (the overwhelmingly common case — every non-browser HTTP client, which is what every
 * legitimate caller of these routes actually is) is always allowed; only a *present* `Origin` outside
 * `env.trustedOrigins` is rejected. Shared by every Bearer route with a request shape simple enough for a
 * browser to actually issue (`governance.ts`, `policy-docs.ts`, `code-reports.ts`, `import.ts`,
 * `mcp-remote.ts`) rather than re-implementing this five times over.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export function isOriginAllowed(origin: string | undefined, trustedOrigins: readonly string[]): boolean {
  return origin === undefined || trustedOrigins.includes(origin);
}

/** Sends the shared `403 origin_not_allowed` body and returns `true` when this request's `Origin` header
 * is present but untrusted — callers must `return` immediately when this returns `true`, exactly like
 * every other early-exit guard in these route handlers. */
export function rejectUntrustedOrigin(req: FastifyRequest, reply: FastifyReply): boolean {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (isOriginAllowed(origin, req.server.env.trustedOrigins)) return false;
  void reply.code(403).send({ error: 'origin_not_allowed' });
  return true;
}
