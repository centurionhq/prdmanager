/**
 * Resolves a Bearer-authenticated *personal* token's caller into a live `PermissionSubject` (SDD-006
 * §Permisos "el permiso efectivo es scope ∩ rol", security review of WO-203/SDD-010: WO-257): a token's
 * own stored `orgId`/`projectIds` only prove what it was scoped to *at creation time* — they say nothing
 * about whether the user behind it is still an org member at all, or still holds a `project_members` row,
 * right now. `import.ts` (`resolveImportSubject`) and `mcp-remote.ts` (`resolveProjectSubject`) already
 * re-derive this live role on every request rather than trusting the token alone; this is that same
 * resolution, factored out so `governance.ts`/`policy-docs.ts`/`code-reports.ts` reuse it instead of a
 * third (or sixth) copy.
 *
 * `null` means "no longer an org member at all" — mapped to the same 404 every other IDOR-safe check in
 * this codebase uses (SDD-006 §Arquitectura: never confirm a resource's existence to someone with no
 * standing to see it). A former org member with no `project_members` row for this specific project still
 * gets a `PermissionSubject` back (`projectRole: undefined`) — `can(subject, action)` correctly denies
 * every action for it on its own, but returning it (rather than `null`) keeps this helper a pure
 * *resolution*, not a decision, exactly like `resolveVisibleProject`/`resolveProjectSubject` already do.
 *
 * Only ever meaningful for a *personal* token (`token.userId` set) — a `project_ci` token has no user
 * behind it to re-check; callers must skip this entirely for those (see each call site's own doc comment).
 */
import type { PermissionSubject } from '@prdm/contracts';
import { createTenantDb, findMembership } from '@prdm/db';
import type { Pool } from 'pg';
import { isOrgAdmin } from './projects.js';

export async function resolveBearerProjectSubject(pool: Pool, orgId: string, projectId: string, userId: string): Promise<PermissionSubject | null> {
  const membership = await findMembership(pool, orgId, userId);
  if (!membership) return null;
  if (isOrgAdmin(membership.role)) return { orgRole: membership.role };
  const projectMembership = await createTenantDb(pool).forOrg(orgId).forProject(projectId).members.findForUser(userId);
  if (!projectMembership) return { orgRole: membership.role };
  return { orgRole: membership.role, projectRole: projectMembership.role };
}
