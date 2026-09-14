/**
 * `POST /api/app/organizations/:orgSlug/projects/:projectSlug/code-reports/force-push-overrides`
 * (SDD-010 "Modo baseline de code-reports", WO-181): the audited admin action that authorizes a CI
 * baseline report's `head_sha` to regress behind the project's currently registered baseline head —
 * project-admin only (`manage_ci_tokens`, the same trust boundary as who can create a baseline-capable
 * CI token in the first place), and every creation is recorded in the audit log.
 */
import { can, forcePushOverrideInputSchema } from '@prdm/contracts';
import { createForcePushOverride, createTenantDb } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';
import { requireMemberOrg } from './require-member-org.js';

export interface RegisterForcePushOverrideRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

export function registerForcePushOverrideRoutes(app: FastifyInstance, opts: RegisterForcePushOverrideRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.post<{ Params: ProjectRouteParams; Body: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/code-reports/force-push-overrides',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'manage_ci_tokens')) throw new ForbiddenError();

      const parsed = forcePushOverrideInputSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new ValidationError('invalid body');

      await createForcePushOverride(pool, {
        projectId: project.id,
        orgId: org.id,
        headSha: parsed.data.headSha,
        authorizedBy: session.user.id,
      });

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'code_report.force_push_override_authorized',
          target: parsed.data.headSha,
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { headSha: parsed.data.headSha };
    },
  );
}
