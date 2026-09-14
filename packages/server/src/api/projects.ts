/**
 * `/api/app/organizations/:orgSlug/projects/*` (SDD-006 §Modelo de datos / §Permisos / §Aislamiento
 * entre proyectos, WO-107): project CRUD, settings and project membership, all scoped through
 * `createTenantDb(pool).forOrg(org.id)` — never a raw `org_id` from the request (SDD-006 §Aislamiento
 * por capas, point 1).
 *
 * Visibility (SDD-006 §Aislamiento entre proyectos: "por defecto nada. Un miembro de la organización sin
 * fila en project_members no ve el proyecto; owner y admin de organización heredan admin de proyecto"):
 * an org owner/admin sees and administers every project in the org; a plain org member only sees
 * projects they have a `project_members` row in, and any other project 404s for them exactly like a
 * project in a different organization — never 403 (SDD-006 §Arquitectura).
 *
 * Everything that mutates state beyond simple visibility is gated through `@prdm/contracts`'s `can`
 * (WO-106), keyed off the caller's *effective* project role (their org role if owner/admin, else their
 * actual `project_members` row).
 */
import { generateProjectId } from '@prdm/core';
import {
  can,
  createProjectInputSchema,
  addProjectMemberInputSchema,
  projectSettingsSchema,
  updateProjectMemberRoleInputSchema,
  updateProjectSettingsInputSchema,
  type PermissionSubject,
  type ProjectSummary,
} from '@prdm/contracts';
import { assertNoSecretsInAuditMetadata, createTenantDb, type OrgRole, type ProjectRecord } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg, type MemberOrg } from './require-member-org.js';

export interface RegisterProjectRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
}

interface OrgRouteParams {
  orgSlug: string;
}

interface ProjectRouteParams extends OrgRouteParams {
  projectSlug: string;
}

interface ProjectMemberRouteParams extends ProjectRouteParams {
  userId: string;
}

function isOrgAdmin(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin';
}

function toProjectSummary(project: ProjectRecord): ProjectSummary {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    graphProjectId: project.graphProjectId,
    settings: projectSettingsSchema.parse(project.settings ?? {}),
    archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
  };
}

function userAgentOf(req: { headers: Record<string, unknown> }): string | undefined {
  return typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
}

/** Resolves `projectSlug` within `org` and enforces SDD-006's visibility rule, throwing `NotFoundError`
 * for both a nonexistent project and a real one the caller (a plain org member) has no `project_members`
 * row for — the two cases are indistinguishable to the caller by design. Returns the caller's *effective*
 * permission subject alongside the project so route handlers never re-derive it. */
async function resolveVisibleProject(
  pool: Pool,
  org: MemberOrg,
  projectSlug: string,
  userId: string,
): Promise<{ project: ProjectRecord; subject: PermissionSubject }> {
  const tenantDb = createTenantDb(pool).forOrg(org.id);
  const project = await tenantDb.projects.findBySlug(projectSlug);
  if (!project) throw new NotFoundError();

  if (isOrgAdmin(org.role)) return { project, subject: { orgRole: org.role } };

  const membership = await tenantDb.forProject(project.id).members.findForUser(userId);
  if (!membership) throw new NotFoundError();
  return { project, subject: { orgRole: org.role, projectRole: membership.role } };
}

export function registerProjectRoutes(app: FastifyInstance, opts: RegisterProjectRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: OrgRouteParams }>('/api/app/organizations/:orgSlug/projects', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const tenantDb = createTenantDb(pool).forOrg(org.id);

    const projects = isOrgAdmin(org.role) ? await tenantDb.projects.list() : await tenantDb.projects.listForUser(session.user.id);

    return { projects: projects.map(toProjectSummary) };
  });

  app.post<{ Params: OrgRouteParams }>('/api/app/organizations/:orgSlug/projects', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    // Creating a project is an org-wide action (there is no project yet to hold a project_members row
    // for) — restricted the same way every other org-wide mutation in ./organizations.ts is.
    if (org.role === 'member') throw new ForbiddenError();

    const parsed = createProjectInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');

    const tenantDb = createTenantDb(pool).forOrg(org.id);
    if (await tenantDb.projects.findBySlug(parsed.data.slug)) throw new ConflictError('a project with this slug already exists');

    const graphProjectId = generateProjectId();
    const settings = parsed.data.settings ?? projectSettingsSchema.parse({});
    let project: ProjectRecord;
    try {
      project = await tenantDb.projects.create({ slug: parsed.data.slug, name: parsed.data.name, graphProjectId, settings });
    } catch {
      throw new ConflictError('a project with this slug already exists');
    }

    await tenantDb.auditLog.record({
      projectId: project.id,
      actorType: 'user',
      actorId: session.user.id,
      action: 'project.created',
      target: project.id,
      metadata: { slug: project.slug },
      ip: req.ip,
      userAgent: userAgentOf(req),
    });

    return { project: toProjectSummary(project) };
  });

  app.get<{ Params: ProjectRouteParams }>('/api/app/organizations/:orgSlug/projects/:projectSlug', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const { project } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
    return { project: toProjectSummary(project) };
  });

  app.patch<{ Params: ProjectRouteParams }>('/api/app/organizations/:orgSlug/projects/:projectSlug/settings', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
    if (!can(subject, 'manage_project_settings')) throw new ForbiddenError();

    const parsed = updateProjectSettingsInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');

    const tenantDb = createTenantDb(pool).forOrg(org.id);
    const updated = await tenantDb.projects.updateSettings(project.id, parsed.data.settings);

    // Sanitized diff, not the raw settings blob: a settings object is user-controlled input and, while
    // it isn't expected to hold secrets, `assertNoSecretsInAuditMetadata` (SDD-006 §Modelo de datos:
    // "metadata sin secretos") is the safety net if it ever does.
    const metadata = { before: project.settings, after: updated.settings };
    assertNoSecretsInAuditMetadata(metadata);
    await tenantDb.auditLog.record({
      projectId: project.id,
      actorType: 'user',
      actorId: session.user.id,
      action: 'project.settings.updated',
      target: project.id,
      metadata,
      ip: req.ip,
      userAgent: userAgentOf(req),
    });

    return { project: toProjectSummary(updated) };
  });

  app.get<{ Params: ProjectRouteParams }>('/api/app/organizations/:orgSlug/projects/:projectSlug/members', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const { project } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);

    const members = await createTenantDb(pool).forOrg(org.id).forProject(project.id).members.list();
    return { members: members.map((m) => ({ userId: m.userId, email: m.email, name: m.name, role: m.role })) };
  });

  app.post<{ Params: ProjectRouteParams }>('/api/app/organizations/:orgSlug/projects/:projectSlug/members', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
    if (!can(subject, 'manage_members')) throw new ForbiddenError();

    const parsed = addProjectMemberInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');

    const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
    const member = await scope.members.upsert({ userId: parsed.data.userId, role: parsed.data.role });

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        projectId: project.id,
        actorType: 'user',
        actorId: session.user.id,
        action: 'project.member.added',
        target: member.userId,
        metadata: { role: member.role },
        ip: req.ip,
        userAgent: userAgentOf(req),
      });

    return { userId: member.userId, role: member.role };
  });

  app.patch<{ Params: ProjectMemberRouteParams }>('/api/app/organizations/:orgSlug/projects/:projectSlug/members/:userId', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
    if (!can(subject, 'manage_members')) throw new ForbiddenError();

    const parsed = updateProjectMemberRoleInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');

    const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
    const existing = await scope.members.findForUser(req.params.userId);
    if (!existing) throw new NotFoundError();

    const member = await scope.members.upsert({ userId: req.params.userId, role: parsed.data.role });

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        projectId: project.id,
        actorType: 'user',
        actorId: session.user.id,
        action: 'project.member.role_changed',
        target: member.userId,
        metadata: { role: member.role },
        ip: req.ip,
        userAgent: userAgentOf(req),
      });

    return { userId: member.userId, role: member.role };
  });

  app.delete<{ Params: ProjectMemberRouteParams }>('/api/app/organizations/:orgSlug/projects/:projectSlug/members/:userId', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
    if (!can(subject, 'manage_members')) throw new ForbiddenError();

    const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
    const existing = await scope.members.findForUser(req.params.userId);
    if (!existing) throw new NotFoundError();

    await scope.members.remove(req.params.userId);

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        projectId: project.id,
        actorType: 'user',
        actorId: session.user.id,
        action: 'project.member.removed',
        target: req.params.userId,
        ip: req.ip,
        userAgent: userAgentOf(req),
      });

    return { userId: req.params.userId };
  });
}
