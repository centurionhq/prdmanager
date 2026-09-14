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
