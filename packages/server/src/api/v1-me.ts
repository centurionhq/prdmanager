/**
 * `GET /api/v1/me` (SDD-006 §Autenticación, WO-109): the minimal Bearer-only route CLI/MCP tooling
 * uses to verify a token before doing anything else. Any valid, unexpired, unrevoked token of either
 * kind can call it — it declares no particular scope requirement beyond "is a real token" (WO-110's
 * route-scope registry, once it lands, marks this with the least-privileged scope that still exists on
 * every kind: `governance:read`, the only scope both `personal` and `project_ci` tokens can carry).
 */
import { findOrganizationById, findUserProfile } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requireBearerToken, type RequireBearerTokenOptions } from '../auth/bearer-auth.js';
import { NotFoundError } from '../errors.js';

export interface RegisterV1MeRouteOptions {
  pool: Pool;
  bearer: RequireBearerTokenOptions;
}

export function registerV1MeRoute(app: FastifyInstance, opts: RegisterV1MeRouteOptions): void {
  const { pool, bearer } = opts;

  app.get('/api/v1/me', async (req) => {
    const token = await requireBearerToken(req, bearer);

    const org = await findOrganizationById(pool, token.orgId);
    if (!org) throw new NotFoundError();

    const user = token.userId ? await findUserProfile(pool, token.userId) : null;

    return {
      organization: { id: org.id, slug: org.slug, name: org.name },
      user: user ? { id: user.userId, handle: user.handle } : null,
      tokenKind: token.kind,
    };
  });
}
