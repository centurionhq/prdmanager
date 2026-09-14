/**
 * Bearer authentication for `/api/v1/*` (SDD-006 §Autenticación / §Permisos "Scopes de tokens",
 * WO-109): a plugin entirely separate from `./register-auth.ts`'s session cookie handling — a route
 * built on {@link requireBearerToken} never also accepts a session cookie, and vice versa (SDD-006:
 * "un plugin Bearer separado del de sesión; una ruta nunca acepta ambos").
 *
 * Order of checks, each one before the next ever touches Postgres:
 *  1. no `cookie` header at all (a Bearer route is CSRF-exempt only because it never reads a cookie in
 *     the first place — SDD-006 §Cabeceras: "Bearer routes are outside CSRF"; a request that carries
 *     one anyway is rejected outright rather than silently ignored, since accepting it would let a
 *     browser-driven request smuggle a session in through a route that's supposed to be
 *     machine-to-machine only).
 *  2. a syntactically valid `Authorization: Bearer <token>` header.
 *  3. {@link parseTokenString} — prefix format and checksum, still no DB access.
 * Only once all three pass does {@link resolveTokenBySecret} (the `resolve_token` `SECURITY DEFINER`
 * function) run, followed by an expiry/revocation check against the caller's own injected `clock`
 * (never `new Date()` — SDD-006 "nada con aserciones de tiempo de reloj"/testability) and, on success,
 * a throttled `last_used_at` touch (`touchTokenLastUsed`, at most once a minute).
 *
 * Every failure path — for any of the reasons above — counts as one failed attempt against
 * {@link KeyedRateLimiter}, keyed by IP (SDD-006 §Autenticación: "Rate limit ... en autenticación
 * Bearer fallida"); a successful call never does.
 */
import { parseTokenString, resolveTokenBySecret, touchTokenLastUsed, type TokenKind } from '@prdm/db';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { RateLimitedError, UnauthorizedError } from '../errors.js';
import type { KeyedRateLimiter } from '../rate-limit/keyed-rate-limit.js';

export interface RequestToken {
  tokenId: string;
  orgId: string;
  kind: TokenKind;
  userId: string | null;
  projectIds: string[] | null;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    token?: RequestToken;
  }
}

export interface RequireBearerTokenOptions {
  pool: Pool;
  clock: () => Date;
  rateLimiter: KeyedRateLimiter;
}

function extractBearerValue(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/.exec(header);
  return match?.[1];
}

/** Counts one failed attempt (per-IP only — a failed Bearer call has no "account" to key on the way
 * sign-in does) and throws `RateLimitedError` once the caller is over budget, `UnauthorizedError`
 * otherwise. Never returns. */
async function failBearerAuth(req: FastifyRequest, rateLimiter: KeyedRateLimiter): Promise<never> {
  const result = await rateLimiter.check(req, undefined);
  if (!result.allowed) throw new RateLimitedError();
  throw new UnauthorizedError();
}

/** Throws `UnauthorizedError`/`RateLimitedError` for anything short of a valid, unexpired, unrevoked
 * token; on success, sets `req.token` and returns it. */
export async function requireBearerToken(req: FastifyRequest, opts: RequireBearerTokenOptions): Promise<RequestToken> {
  const { pool, clock, rateLimiter } = opts;

  if (typeof req.headers.cookie === 'string' && req.headers.cookie.length > 0) {
    return failBearerAuth(req, rateLimiter);
  }

  const value = extractBearerValue(req);
  if (!value) return failBearerAuth(req, rateLimiter);

  const parsed = parseTokenString(value);
  if (!parsed) return failBearerAuth(req, rateLimiter);

  const resolved = await resolveTokenBySecret(pool, parsed.secret);
  if (!resolved) return failBearerAuth(req, rateLimiter);

  const now = clock();
  if (resolved.revokedAt || resolved.expiresAt.getTime() <= now.getTime()) {
    return failBearerAuth(req, rateLimiter);
  }

  await touchTokenLastUsed(pool, { orgId: resolved.orgId, tokenId: resolved.id, now });

  const token: RequestToken = {
    tokenId: resolved.id,
    orgId: resolved.orgId,
    kind: resolved.kind,
    userId: resolved.userId,
    projectIds: resolved.projectIds,
    scopes: resolved.scopes,
  };
  req.token = token;
  return token;
}
