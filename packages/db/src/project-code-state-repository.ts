/**
 * `project_code_state` repository (SDD-007/SDD-010, WO-134/WO-181): the small per-project row a
 * CI-verified baseline report updates — `impacts_hashes` (WO-134's reconciliation-by-hash) and
 * `latest_baseline_head_sha` (WO-181's force-push guard). Reads/writes are exposed separately from
 * `PgProjectEngine`'s own private `loadImpactsHashes` (SDD-007) since the baseline gate (WO-181) needs
 * to read/write this row *before* deciding whether to even call `PgProjectEngine.refresh()` at all.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { projectCodeState } from './schema/documents.js';
import { withTenantTx } from './tenant.js';

export interface ProjectCodeStateRecord {
  projectId: string;
  impactsHashes: Record<string, string> | null;
  latestBaselineHeadSha: string | null;
}

export async function getProjectCodeState(pool: Pool, orgId: string, projectId: string): Promise<ProjectCodeStateRecord | null> {
  return withTenantTx(pool, orgId, async (tx) => {
    const [row] = await tx
      .select({ projectId: projectCodeState.projectId, impactsHashes: projectCodeState.impactsHashes, latestBaselineHeadSha: projectCodeState.latestBaselineHeadSha })
      .from(projectCodeState)
      .where(eq(projectCodeState.projectId, projectId));
    return row ? { projectId: row.projectId, impactsHashes: (row.impactsHashes as Record<string, string> | null) ?? null, latestBaselineHeadSha: row.latestBaselineHeadSha } : null;
  });
}

export interface RecordBaselineHeadInput {
  projectId: string;
  orgId: string;
  headSha: string;
  impactsHashes: Record<string, string>;
}

/** Merges `impactsHashes` into whatever is already stored (never a wholesale replace — a report only
 * ever covers the blueprints its own `impacts_hashes` names) and advances `latest_baseline_head_sha`.
 * Only ever called after a report has already earned baseline trust (WO-181's gate). */
export async function recordBaselineHead(pool: Pool, input: RecordBaselineHeadInput): Promise<void> {
  await withTenantTx(pool, input.orgId, async (tx) => {
    const [existing] = await tx.select({ impactsHashes: projectCodeState.impactsHashes }).from(projectCodeState).where(eq(projectCodeState.projectId, input.projectId));
    const merged = { ...((existing?.impactsHashes as Record<string, string> | null) ?? {}), ...input.impactsHashes };
    await tx
      .insert(projectCodeState)
      .values({ projectId: input.projectId, orgId: input.orgId, impactsHashes: merged, latestBaselineHeadSha: input.headSha })
      .onConflictDoUpdate({ target: projectCodeState.projectId, set: { impactsHashes: merged, latestBaselineHeadSha: input.headSha } });
  });
}
