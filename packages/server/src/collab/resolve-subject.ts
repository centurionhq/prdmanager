/**
 * Resolves the `@prdm/contracts` `PermissionSubject` for a `(orgId, projectId, userId)` triple — the
 * same shape `resolveVisibleProject` (`../api/projects.js`) builds from an org slug, but starting from
 * the already-known internal uuids a `/collab` `documentName` resolves to (SDD-008 §"Servidor de tiempo
 * real"). `null` when the user isn't even an org member, or is an org member with no `project_members`
 * row for this specific project (SDD-006 §Aislamiento entre proyectos) — both map to the same generic
 * rejection at the call site, never a distinguishable error.
 */
import { createTenantDb, findMembership, type OrgRole } from '@prdm/db';
import type { PermissionSubject } from '@prdm/contracts';
import type { Pool } from 'pg';

function isOrgAdmin(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin';
}

export async function resolveCollabPermissionSubject(pool: Pool, orgId: string, projectId: string, userId: string): Promise<PermissionSubject | null> {
  const membership = await findMembership(pool, orgId, userId);
  if (!membership) return null;
  if (isOrgAdmin(membership.role)) return { orgRole: membership.role };

  const projectMembership = await createTenantDb(pool).forOrg(orgId).forProject(projectId).members.findForUser(userId);
  if (!projectMembership) return null;
  return { orgRole: membership.role, projectRole: projectMembership.role };
}
