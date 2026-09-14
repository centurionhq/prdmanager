/**
 * Organization membership queries and role mutations (SDD-006 §Modelo de datos / §Permisos, WO-104).
 *
 * `organization` and `member` are better-auth's own tables (SDD-006 §Modelo de datos: "Tablas de
 * better-auth ... son globales, sin RLS"), so every function here reads/writes them directly through
 * `pool` — never `withTenantTx` (that's reserved for `org_id`-scoped, RLS-forced tables) — and instead
 * derives its own authorization from the `role` column, exactly like better-auth's own organization
 * plugin does internally.
 *
 * `setMemberRole`/`removeMember` run inside a single transaction that locks *every* membership row for
 * the organization (`FOR UPDATE`) before checking the "admin cannot touch an owner" and "the last owner
 * cannot be removed or demoted" rules from SDD-006 §Permisos: locking only the target row would let two
 * concurrent requests against two different owners each observe "more than one owner" before either
 * commits, and demote both — locking the whole org's membership set serializes any concurrent role
 * change or removal within that org instead.
 */
import type { PoolClient } from 'pg';
import type { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import { connect } from './pool.js';
import { member, organization, user } from './schema/auth.js';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrganizationMembership {
  organizationId: string;
  slug: string;
  name: string;
  role: OrgRole;
}

export interface OrganizationRecord {
  id: string;
  slug: string;
  name: string;
}

export interface OrganizationMemberRecord {
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
}

export class MembershipNotFoundError extends Error {
  constructor() {
    super('membership not found');
    this.name = 'MembershipNotFoundError';
  }
}

/** Thrown for both SDD-006 §Permisos org-role rules: an admin touching an owner, and removing/demoting
 * the last owner. Callers map this to a 403 (the caller IS a member of the org, just not allowed to
 * perform this particular mutation — unlike a missing org/membership, which is a 404). */
export class OrgRoleRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgRoleRuleError';
  }
}

export async function listOrganizationsForUser(pool: Pool, userId: string): Promise<OrganizationMembership[]> {
  const db = connect(pool);
  const rows = await db
    .select({ organizationId: organization.id, slug: organization.slug, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
  return rows.map((row) => ({ ...row, role: row.role as OrgRole }));
}

export async function findOrganizationBySlug(pool: Pool, slug: string): Promise<OrganizationRecord | null> {
  const db = connect(pool);
  const rows = await db.select({ id: organization.id, slug: organization.slug, name: organization.name }).from(organization).where(eq(organization.slug, slug));
  return rows[0] ?? null;
}

/** Looks an organization up by its internal id rather than its slug — used by callers that already
 * resolved `org_id` some other way (e.g. the Bearer plugin's `resolve_token`, WO-109) and never had a
 * slug to begin with. */
export async function findOrganizationById(pool: Pool, organizationId: string): Promise<OrganizationRecord | null> {
  const db = connect(pool);
  const rows = await db.select({ id: organization.id, slug: organization.slug, name: organization.name }).from(organization).where(eq(organization.id, organizationId));
  return rows[0] ?? null;
}

export async function findMembership(pool: Pool, organizationId: string, userId: string): Promise<{ role: OrgRole } | null> {
  const db = connect(pool);
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
  return rows[0] ? { role: rows[0].role as OrgRole } : null;
}

export async function listOrganizationMembers(pool: Pool, organizationId: string): Promise<OrganizationMemberRecord[]> {
  const db = connect(pool);
  const rows = await db
    .select({ userId: member.userId, email: user.email, name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId));
  return rows.map((row) => ({ ...row, role: row.role as OrgRole }));
}

interface LockedMemberRow {
  user_id: string;
  role: OrgRole;
}

async function lockOrgMembers(client: PoolClient, organizationId: string): Promise<LockedMemberRow[]> {
  const { rows } = await client.query<LockedMemberRow>(
    `SELECT "userId" AS user_id, "role" FROM "member" WHERE "organizationId" = $1 FOR UPDATE`,
    [organizationId],
  );
  return rows;
}

function assertRoleMutationAllowed(actorRole: OrgRole, targetRole: OrgRole, newRole: OrgRole | undefined, ownerCount: number): void {
  if (actorRole === 'admin' && (targetRole === 'owner' || newRole === 'owner')) {
    throw new OrgRoleRuleError('an admin cannot grant, remove or demote an owner');
  }
  if (targetRole === 'owner' && newRole !== 'owner' && ownerCount <= 1) {
    throw new OrgRoleRuleError('the last owner cannot be removed or demoted');
  }
}

/** Changes `targetUserId`'s role within `organizationId`, enforcing SDD-006 §Permisos's org-role rules
 * atomically. Throws `MembershipNotFoundError` if `targetUserId` isn't a member (maps to 404 — the
 * resource doesn't exist from the caller's side), or `OrgRoleRuleError` if the rules forbid it (maps to
 * 403 — the resource exists, the caller just can't do this to it). */
export async function setMemberRole(pool: Pool, organizationId: string, actorRole: OrgRole, targetUserId: string, newRole: OrgRole): Promise<OrgRole> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await lockOrgMembers(client, organizationId);
    const target = rows.find((row) => row.user_id === targetUserId);
    if (!target) throw new MembershipNotFoundError();
    const ownerCount = rows.filter((row) => row.role === 'owner').length;
    assertRoleMutationAllowed(actorRole, target.role, newRole, ownerCount);
    await client.query(`UPDATE "member" SET "role" = $1 WHERE "organizationId" = $2 AND "userId" = $3`, [newRole, organizationId, targetUserId]);
    await client.query('COMMIT');
    return newRole;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Removes `targetUserId` from `organizationId`, enforcing the same last-owner rule as `setMemberRole`
 * (removal is treated as "demoting to no role" for that purpose). */
export async function removeOrganizationMember(pool: Pool, organizationId: string, actorRole: OrgRole, targetUserId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await lockOrgMembers(client, organizationId);
    const target = rows.find((row) => row.user_id === targetUserId);
    if (!target) throw new MembershipNotFoundError();
    const ownerCount = rows.filter((row) => row.role === 'owner').length;
    assertRoleMutationAllowed(actorRole, target.role, undefined, ownerCount);
    await client.query(`DELETE FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [organizationId, targetUserId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
