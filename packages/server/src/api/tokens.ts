/**
 * `/api/app/tokens` (SDD-006 §Modelo de datos / §Permisos "Scopes de tokens", WO-109): personal API
 * tokens — create, list (own, never with secrets) and revoke (own). Session-authenticated, like every
 * other `/api/app/*` route.
 *
 * DEVIATION (documented): SDD-006/WO-109 name the route `/api/app/tokens` with no `:orgSlug` segment,
 * but `api_tokens.org_id` is `NOT NULL` (a personal token is always scoped to one organization, same
 * as everything else this SDD governs) and SDD-006 §Aislamiento por capas point 1 requires `org_id` to
 * always be *derived* server-side from "sesión + membresía del orgSlug" — never accepted raw from the
 * request. Since the path itself carries no `orgSlug`, these routes take it from the request body
 * (`POST`) or query string (`GET`) instead, and still resolve it exactly like every other org-scoped
 * route (`requireMemberOrg`, 404 for a slug the caller isn't a member of) before ever touching
 * `api_tokens`.
 */
import { createPersonalTokenInputSchema } from '@prdm/contracts';
import { createPersonalToken, createTenantDb, findTokenById, InvalidScopeError, listPersonalTokens, revokeToken, TokenTtlTooLongError, type TokenRecord } from '@prdm/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';

export interface RegisterTokenRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  clock: () => Date;
}

interface OrgSlugQuery {
  orgSlug?: string;
}

interface RevokeTokenParams {
  tokenId: string;
}

function toTokenSummary(record: TokenRecord) {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    expiresAt: record.expiresAt.toISOString(),
    lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

function requireOrgSlug(value: string | undefined): string {
  if (!value) throw new ValidationError('orgSlug is required');
  return value;
}

function userAgentOf(req: FastifyRequest): string | undefined {
  return typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
}

export function registerTokenRoutes(app: FastifyInstance, opts: RegisterTokenRoutesOptions): void {
  const { auth, pool, env, clock } = opts;

  app.get<{ Querystring: OrgSlugQuery }>('/api/app/tokens', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, requireOrgSlug(req.query.orgSlug), session.user.id);

    const tokens = await listPersonalTokens(pool, org.id, session.user.id);
    return { tokens: tokens.map(toTokenSummary) };
  });

  app.post<{ Body: { orgSlug?: string } & Record<string, unknown> }>('/api/app/tokens', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const body = req.body ?? {};
    const org = await requireMemberOrg(pool, requireOrgSlug(body.orgSlug), session.user.id);

    const parsed = createPersonalTokenInputSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('invalid body');

    const now = clock();
    let created;
    try {
      created = await createPersonalToken(pool, {
        orgId: org.id,
        userId: session.user.id,
        name: parsed.data.name,
        scopes: parsed.data.scopes,
        expiresAt: new Date(parsed.data.expiresAt),
        now,
      });
    } catch (err) {
      if (err instanceof InvalidScopeError || err instanceof TokenTtlTooLongError) throw new ValidationError(err.message);
      throw err;
    }

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        actorType: 'user',
        actorId: session.user.id,
        action: 'token.personal.created',
        target: created.record.id,
        metadata: { name: created.record.name, scopes: created.record.scopes },
        ip: req.ip,
        userAgent: userAgentOf(req),
      });

    return { token: toTokenSummary(created.record), secret: created.token };
  });

  app.post<{ Params: RevokeTokenParams; Querystring: OrgSlugQuery; Body: OrgSlugQuery }>(
    '/api/app/tokens/:tokenId/revoke',
    { config: { access: { kind: 'session' } } },
    async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const orgSlug = req.query.orgSlug ?? req.body?.orgSlug;
    const org = await requireMemberOrg(pool, requireOrgSlug(orgSlug), session.user.id);

    const existing = await findTokenById(pool, org.id, req.params.tokenId);
    if (!existing || existing.kind !== 'personal' || existing.userId !== session.user.id) throw new NotFoundError();

    await revokeToken(pool, { orgId: org.id, tokenId: req.params.tokenId, now: clock() });

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        actorType: 'user',
        actorId: session.user.id,
        action: 'token.personal.revoked',
        target: req.params.tokenId,
        ip: req.ip,
        userAgent: userAgentOf(req),
      });

    return { tokenId: req.params.tokenId };
    },
  );
}
