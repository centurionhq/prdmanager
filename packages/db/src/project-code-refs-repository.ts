/**
 * `project_code_refs` repository (SDD-012 "Centurion Factory conectado al backend SaaS", WO-332): the
 * persisted per-ref governance state a baseline code report writes and `PgProjectEngine.buildDriftInput`
 * (WO-334) reads back — see `packages/db/src/schema/documents.ts`'s own module doc comment for the
 * table's shape/rationale.
 */
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { projectCodeRefs } from './schema/documents.js';
import { withTenantTx } from './tenant.js';

export type ProjectCodeRefRecord = typeof projectCodeRefs.$inferSelect;

export interface ProjectCodeRefInput {
  refKey: string;
  path: string;
  symbol: string | null;
  hash: string | null;
  hashAlgoVersion: number;
}

export interface ReplaceProjectCodeRefsInput {
  projectId: string;
  orgId: string;
  blueprintId: string;
  reportId: string;
  headSha: string;
  refs: readonly ProjectCodeRefInput[];
}

/**
 * Transactionally replaces every ref this project+blueprint has on record with `refs` — a full
 * delete-then-insert, never a merge (WO-333 calls this once per blueprint named in a baseline report's
 * `governed[]`; a blueprint absent from a ref no longer governs it, so its old row must not survive).
 */
export async function replaceProjectCodeRefs(pool: Pool, input: ReplaceProjectCodeRefsInput): Promise<void> {
  await withTenantTx(pool, input.orgId, async (tx) => {
    await tx.delete(projectCodeRefs).where(and(eq(projectCodeRefs.projectId, input.projectId), eq(projectCodeRefs.blueprintId, input.blueprintId)));
    if (input.refs.length === 0) return;
    await tx.insert(projectCodeRefs).values(
      input.refs.map((ref) => ({
        projectId: input.projectId,
        orgId: input.orgId,
        blueprintId: input.blueprintId,
        refKey: ref.refKey,
        path: ref.path,
        symbol: ref.symbol,
        hash: ref.hash,
        hashAlgoVersion: ref.hashAlgoVersion,
        reportId: input.reportId,
        headSha: input.headSha,
      })),
    );
  });
}

export interface ListProjectCodeRefsInput {
  projectId: string;
  orgId: string;
}

export async function listProjectCodeRefs(pool: Pool, input: ListProjectCodeRefsInput): Promise<ProjectCodeRefRecord[]> {
  return withTenantTx(pool, input.orgId, (tx) => tx.select().from(projectCodeRefs).where(eq(projectCodeRefs.projectId, input.projectId)));
}
