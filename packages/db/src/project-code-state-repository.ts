/**
 * `project_code_state` repository (SDD-007/SDD-010, WO-134/WO-181): the small per-project row a
 * CI-verified baseline report updates — `impacts_hashes` (WO-134's reconciliation-by-hash) and
 * `latest_baseline_head_sha` (WO-181's force-push guard). Reads/writes are exposed separately from
 * `PgProjectEngine`'s own private `loadImpactsHashes` (SDD-007) since the baseline gate (WO-181) needs
 * to read/write this row *before* deciding whether to even call `PgProjectEngine.refresh()` at all.
 */
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { projectCodeState } from './schema/documents.js';
import { withTenantTx } from './tenant.js';

/** Same numeric salt as `packages/server/src/engine/pg-project-engine.ts`'s own `WRITE_LOCK_SALT` (same
 * keyspace: `pg_advisory_xact_lock(hashtextextended(project_id, salt))`, keyed only by project id and
 * this literal number — Postgres advisory locks are global to the database, not scoped by package, so
 * this value must be kept in sync with that file by hand, same convention already used between
 * `collab/doc-update-writer.ts`/`collab/restore.ts`/`collab/accept-agent-proposal.ts`'s shared
 * `DOC_UPDATES_LOCK_SALT`). WO-233: taking it here, as the very first statement of this transaction,
 * serializes `recordBaselineHead`'s read-modify-write of `impacts_hashes` against every other write this
 * project's `PgProjectEngine` ever makes (`transaction()`/`refresh()`/`acknowledge()` all take the exact
 * same lock) — including, critically, another concurrent `recordBaselineHead` call for the same project,
 * which previously raced this same read-modify-write with no lock at all and could silently lose one
 * side's `impacts_hashes` contribution. */
const WRITE_LOCK_SALT = 0;

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
  /** WO-333: this report's own `governed_warnings[]` (`@prdm/contracts`' `governedWarningSchema`),
   * stored verbatim — a full replace (not a merge, unlike `impactsHashes`), since a warning list only
   * ever reflects the *latest* report's own findings. `undefined` leaves the column untouched, so a
   * caller that hasn't adopted this field yet keeps its previous behavior exactly. */
  governedWarnings?: readonly { blueprintId: string; message: string }[];
}

/** Merges `impactsHashes` into whatever is already stored (never a wholesale replace — a report only
 * ever covers the blueprints its own `impacts_hashes` names) and advances `latest_baseline_head_sha`.
 * Only ever called after a report has already earned baseline trust (WO-181's gate).
 *
 * WO-233: the read-modify-write below used to run with no lock at all, in a transaction entirely
 * separate from `PgProjectEngine.refresh()`'s own advisory-locked one — two distinct, legitimate
 * concurrent baseline reports for the same project could each read the same starting `impactsHashes`,
 * merge their own new entry independently, and whichever wrote last would silently discard the other's
 * contribution. Taking the exact same advisory lock `refresh()` uses, as the first statement of this
 * transaction, makes a second concurrent call genuinely wait for the first to commit — so it always
 * merges against the *other* call's already-committed result, never a stale read. */
export async function recordBaselineHead(pool: Pool, input: RecordBaselineHeadInput): Promise<void> {
  await withTenantTx(pool, input.orgId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}::text, ${WRITE_LOCK_SALT}))`);
    const [existing] = await tx.select({ impactsHashes: projectCodeState.impactsHashes }).from(projectCodeState).where(eq(projectCodeState.projectId, input.projectId));
    const merged = { ...((existing?.impactsHashes as Record<string, string> | null) ?? {}), ...input.impactsHashes };
    const governedWarnings = input.governedWarnings !== undefined ? [...input.governedWarnings] : undefined;
    await tx
      .insert(projectCodeState)
      .values({ projectId: input.projectId, orgId: input.orgId, impactsHashes: merged, latestBaselineHeadSha: input.headSha, governedWarnings })
      .onConflictDoUpdate({ target: projectCodeState.projectId, set: { impactsHashes: merged, latestBaselineHeadSha: input.headSha, ...(governedWarnings !== undefined ? { governedWarnings } : {}) } });
  });
}
