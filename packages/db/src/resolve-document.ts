/**
 * Pre-tenant document resolution (SDD-006 §Aislamiento por capas, point 3; SDD-008 §"Servidor de tiempo
 * real"): the only way `prdm_app` can learn which organization/project a document belongs to before
 * `app.org_id` is set, backed by the `resolve_document` `SECURITY DEFINER` function hand-appended to
 * `packages/db/migrations/0007_documents_and_code_state.sql` (same WO-097 template as
 * `resolveProjectById`). Returns `null` for "no match", never throwing, so a `/collab` connection for an
 * unknown or malformed document uuid maps to the same rejection as a real cross-tenant one.
 */
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { connect } from './pool.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedDocumentOrg {
  orgId: string;
  projectId: string;
}

interface ResolveDocumentRow extends Record<string, unknown> {
  org_id: string;
  project_id: string;
}

export async function resolveDocumentById(pool: Pool, documentId: string): Promise<ResolvedDocumentOrg | null> {
  if (!UUID_PATTERN.test(documentId)) return null;
  const db = connect(pool);
  const result = await db.execute<ResolveDocumentRow>(sql`SELECT * FROM resolve_document(${documentId}::uuid)`);
  const row = result.rows[0];
  return row ? { orgId: row.org_id, projectId: row.project_id } : null;
}
