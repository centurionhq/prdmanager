/**
 * Shared "resolve an org by slug and require the caller to be a member of it" guard (SDD-006
 * §Arquitectura, WO-104/WO-105): wrong slug and non-member alike 404, never 403 — factored out of
 * `./organizations.ts` so `./organization-invitations.ts` reuses the exact same resolution instead of a
 * second copy.
 */
import { findMembership, findOrganizationBySlug, type OrgRole } from '@prdm/db';
import type { Pool } from 'pg';
import { NotFoundError } from '../errors.js';

export interface MemberOrg {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
}

export async function requireMemberOrg(pool: Pool, orgSlug: string, userId: string): Promise<MemberOrg> {
  const org = await findOrganizationBySlug(pool, orgSlug);
  if (!org) throw new NotFoundError();
  const membership = await findMembership(pool, org.id, userId);
  if (!membership) throw new NotFoundError();
  return { ...org, role: membership.role };
}
