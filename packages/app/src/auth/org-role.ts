import type { OrgRole } from '@prdm/contracts';

/** SDD-006 §Permisos: org-wide mutations (creating a project, managing members/invitations) require
 * `owner` or `admin` — mirrors `packages/server/src/api/organizations.ts`'s own `org.role === 'member'`
 * gate. This only hides/shows UI affordances; the server is still the enforcement authority. */
export function isOrgAdmin(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin';
}
