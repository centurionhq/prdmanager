/**
 * Consulta de auditoría con filtros en el servidor (SDD-091, WO-704): `action`, rango `created_at` y actor
 * van al `WHERE` (nunca sobre la página), y el `total` del recorte se cuenta en la misma transacción de
 * tenant. `auditFacets` agrega acciones/actores distintos con conteo. El nombre del actor lo resuelve el
 * server (SDD-088); este módulo lo devuelve siempre `null`.
 */
import { and, asc, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { decodeCursor, paginateKeyset } from './pagination.js';
import type { AuditLogRecord } from './repositories.js';
import { auditLog } from './schema/audit.js';
import { withTenantTx } from './tenant.js';

const DEFAULT_LIMIT = 50;

export interface AuditLogQueryInput {
  projectId?: string;
  action?: string;
  /** Inclusivo: `created_at >= from`. */
  from?: Date;
  /** Inclusivo: `created_at <= to`. */
  to?: Date;
  actorType?: string;
  actorId?: string;
  cursor?: string | null;
  limit?: number;
}

export interface AuditLogQueryPage {
  items: AuditLogRecord[];
  nextCursor: string | null;
  total: number;
}

function filterConditions(input: AuditLogQueryInput) {
  const conditions = [];
  if (input.action) conditions.push(eq(auditLog.action, input.action));
  if (input.projectId) conditions.push(eq(auditLog.projectId, input.projectId));
  if (input.from) conditions.push(gte(auditLog.createdAt, input.from));
  if (input.to) conditions.push(lte(auditLog.createdAt, input.to));
  if (input.actorType) conditions.push(eq(auditLog.actorType, input.actorType));
  if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
  return conditions;
}

export async function listAuditEntries(pool: Pool, orgId: string, input: AuditLogQueryInput = {}): Promise<AuditLogQueryPage> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const cursor = decodeCursor(input.cursor);
  return withTenantTx(pool, orgId, async (tx) => {
    const filters = filterConditions(input);
    const pageConditions = [...filters];
    if (cursor) pageConditions.push(or(lt(auditLog.createdAt, cursor.timestamp), and(eq(auditLog.createdAt, cursor.timestamp), lt(auditLog.id, cursor.id))!)!);
    const rows = await tx
      .select()
      .from(auditLog)
      .where(pageConditions.length > 0 ? and(...pageConditions) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit + 1);
    const [counted] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(filters.length > 0 ? and(...filters) : undefined);
    const page = paginateKeyset(rows, limit, (row) => ({ timestamp: row.createdAt, id: row.id }));
    return { ...page, total: counted?.total ?? 0 };
  });
}

export interface AuditFacetsInput {
  projectId?: string;
}

export interface AuditFacets {
  actions: { action: string; count: number }[];
  actors: { type: string; id: string; name: null; count: number }[];
  total: number;
}

export async function auditFacets(pool: Pool, orgId: string, input: AuditFacetsInput = {}): Promise<AuditFacets> {
  return withTenantTx(pool, orgId, async (tx) => {
    const scope = input.projectId ? eq(auditLog.projectId, input.projectId) : undefined;
    const count = sql<number>`count(*)::int`;
    const actions = await tx
      .select({ action: auditLog.action, count })
      .from(auditLog)
      .where(scope)
      .groupBy(auditLog.action)
      .orderBy(desc(count), asc(auditLog.action));
    const actorRows = await tx
      .select({ type: auditLog.actorType, id: auditLog.actorId, count })
      .from(auditLog)
      .where(scope)
      .groupBy(auditLog.actorType, auditLog.actorId)
      .orderBy(desc(count), asc(auditLog.actorType), asc(auditLog.actorId));
    const [counted] = await tx.select({ total: count }).from(auditLog).where(scope);
    return {
      actions,
      actors: actorRows.map((row) => ({ ...row, name: null })),
      total: counted?.total ?? 0,
    };
  });
}
