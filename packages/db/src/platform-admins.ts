/**
 * `platform_admins` reads (SDD-006 §Modelo de datos, WO-101). `prdm_app` only ever gets `SELECT` on
 * this table (the WO-099 catalog test asserts it); the one `INSERT` this package performs
 * (`insertPlatformAdmin`) is exported for the bootstrap CLI (WO-101), which runs against
 * `DATABASE_MIGRATION_URL` — a `prdm_owner`-credentialed pool — never `prdm_app`.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { connect } from './pool.js';
import { platformAdmins } from './schema/audit.js';
import { recordPlatformAuditLog } from './platform-audit.js';

export async function isPlatformAdmin(pool: Pool, userId: string): Promise<boolean> {
  const db = connect(pool);
  const rows = await db.select({ userId: platformAdmins.userId }).from(platformAdmins).where(eq(platformAdmins.userId, userId));
  return rows.length > 0;
}

export async function countPlatformAdmins(pool: Pool): Promise<number> {
  const db = connect(pool);
  const rows = await db.select({ userId: platformAdmins.userId }).from(platformAdmins);
  return rows.length;
}

/** `prdm_owner`-only (see module doc comment): inserts the row that makes `userId` a superadmin. */
export async function insertPlatformAdmin(pool: Pool, userId: string, createdBy?: string): Promise<void> {
  const db = connect(pool);
  await db.insert(platformAdmins).values({ userId, createdBy: createdBy ?? null });
}

/**
 * Belt-and-suspenders cleanup for the `POST /api/app/admin/organizations` window (security review #1,
 * WO-101): `createOrganization` and `stripCreatorMembership` are two separate, non-transactional
 * statements (better-auth's internal writes aren't composable into one transaction), so a crash between
 * them — or in `inviteOrganizationOwner`/`recordPlatformAuditLog`, which run after the strip but could
 * still leave a *different* stale row from an earlier failed attempt — could leave a superadmin holding
 * a `member` row, contradicting "sin acceso implícito al contenido". Run once at server startup: finds
 * every `member` row whose `userId` is a platform admin and removes it, auditing each one removed so an
 * operator can see it happened. Idempotent and cheap (no-op when nothing needs cleaning); not meant to
 * run per-request.
 */
export async function reconcileSuperadminMemberships(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ id: string; organizationId: string; userId: string }>(
    `DELETE FROM "member" WHERE "userId" IN (SELECT "user_id" FROM "platform_admins") RETURNING "id", "organizationId", "userId"`,
  );
  for (const row of rows) {
    await recordPlatformAuditLog(pool, {
      actorType: 'system',
      actorId: 'reconcile-superadmin-memberships',
      action: 'platform.superadmin_membership.reconciled',
      target: row.organizationId,
      metadata: { removedMemberId: row.id, userId: row.userId },
    });
  }
  return rows.length;
}
