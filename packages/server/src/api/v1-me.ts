/**
 * `GET /api/v1/me` (SDD-006 §Autenticación, WO-109/WO-110): the minimal Bearer-only route CLI/MCP
 * tooling uses to verify a token before doing anything else. Any valid, unexpired, unrevoked token of
 * either kind can call it (`{ kind: 'bearer', scope: 'any' }`) — the global Bearer preHandler
 * (`../access/bearer-access-prehandler.js`) has already authenticated the token and set `request.token`
 * by the time this handler runs.
 */
import { findOrganizationById, findUserProfile } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { NotFoundError } from '../errors.js';

export interface RegisterV1MeRouteOptions {
  pool: Pool;
}

export function registerV1MeRoute(app: FastifyInstance, opts: RegisterV1MeRouteOptions): void {
  const { pool } = opts;

  app.get(
    '/api/v1/me',
    { config: { access: { kind: 'bearer', scope: 'any' } } },
    async (req) => {
      const token = req.token!;

      const org = await findOrganizationById(pool, token.orgId);
      if (!org) throw new NotFoundError();

      const user = token.userId ? await findUserProfile(pool, token.userId) : null;

      return {
        organization: { id: org.id, slug: org.slug, name: org.name },
        user: user ? { id: user.userId, handle: user.handle } : null,
        tokenKind: token.kind,
      };
    },
  );
}
