/**
 * `platform_audit_log` (SDD-006 §Modelo de datos): no `org_id`, no RLS — a plain insert on `pool`
 * (the `prdm_app` pool) is enough, since isolation here is entirely about the *grant* (`prdm_app` has
 * INSERT but not SELECT on the table itself) rather than a row-level policy. Reading goes through
 * `read_platform_audit_log`, the `SECURITY DEFINER` function from the WO-103 migration.
 *
 * Deliberately never uses `.returning()`/`RETURNING` here: Postgres requires SELECT privilege on the
 * referenced columns for a `RETURNING` clause, same as for reading the row any other way, so an
 * INSERT-only grant (no SELECT) makes `INSERT ... RETURNING *` fail with `permission denied` too.
 * The written row is built client-side instead (id/createdAt/metadata mirror the schema's own
 * defaults) precisely so the INSERT-only grant can stay exactly that.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { assertNoSecretsInAuditMetadata } from './audit-metadata.js';
import { connect } from './pool.js';
import { platformAuditLog } from './schema/audit.js';

export type PlatformAuditLogRecord = typeof platformAuditLog.$inferSelect;

export interface NewPlatformAuditLogEntryInput {
  actorType: 'user' | 'system';
  actorId?: string;
  action: string;
  target?: string;
  /** Rejected up front by `assertNoSecretsInAuditMetadata` (SDD-006 §Modelo de datos). */
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function recordPlatformAuditLog(pool: Pool, entry: NewPlatformAuditLogEntryInput): Promise<PlatformAuditLogRecord> {
  assertNoSecretsInAuditMetadata(entry.metadata ?? {});
  const db = connect(pool);
  const row: PlatformAuditLogRecord = {
    id: randomUUID(),
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    createdAt: new Date(),
  };
  await db.insert(platformAuditLog).values(row);
  return row;
}

interface RawPlatformAuditLogRow extends Record<string, unknown> {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

/**
 * Throws (Postgres `insufficient_privilege`) if `callerUserId` isn't in `platform_admins` — enforced
 * inside the `SECURITY DEFINER` function itself, not here, so there is no code path in this package
 * that reads `platform_audit_log` without going through that check.
 *
 * Calls the function through raw `sql.execute` (rather than a Drizzle-mapped query, which only knows
 * how to call functions that return a single scalar) so column names come back snake_case, as
 * Postgres itself names them — mapped here to match `PlatformAuditLogRecord`'s camelCase shape.
 */
export async function readPlatformAuditLog(pool: Pool, callerUserId: string): Promise<PlatformAuditLogRecord[]> {
  const db = connect(pool);
  const result = await db.execute<RawPlatformAuditLogRow>(sql`SELECT * FROM read_platform_audit_log(${callerUserId})`);
  return result.rows.map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    target: row.target,
    metadata: row.metadata,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: new Date(row.created_at),
  }));
}
