/**
 * `code_reports` idempotency repository (SDD-010 "Sync de developers y drift", WO-180): the entire
 * concurrency-safety story is Postgres's own unique index on `(project_id, token_id, idempotency_key)`
 * (`./schema/code-reports.ts`'s own doc comment) — `recordCodeReport` is a single `INSERT ... ON
 * CONFLICT DO NOTHING` carrying the *complete*, already-computed result, falling back to a `SELECT` of
 * the existing row only when the insert no-ops. Because the full result travels inside the same INSERT
 * as the reservation, there is no "reserved but still processing" window a concurrent loser could ever
 * observe: Postgres blocks a conflicting `INSERT` on the same key until the first transaction commits
 * or rolls back, so by the time the loser's own fallback `SELECT` runs, the winner's row (result
 * included) is already fully committed.
 */
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { codeReports } from './schema/code-reports.js';
import { withTenantTx } from './tenant.js';

export type CodeReportMode = 'baseline' | 'preview';

export interface CodeReportRecord {
  id: string;
  projectId: string;
  orgId: string;
  tokenId: string;
  idempotencyKey: string;
  bodySha256: string;
  mode: CodeReportMode;
  headSha: string;
  result: unknown;
  createdAt: Date;
}

export interface RecordCodeReportInput {
  projectId: string;
  orgId: string;
  tokenId: string;
  idempotencyKey: string;
  bodySha256: string;
  mode: CodeReportMode;
  headSha: string;
  result: unknown;
}

export type RecordCodeReportOutcome =
  | { kind: 'created'; record: CodeReportRecord }
  | { kind: 'replayed'; record: CodeReportRecord }
  | { kind: 'mismatch'; record: CodeReportRecord };

export interface FindCodeReportByIdempotencyKeyInput {
  projectId: string;
  orgId: string;
  tokenId: string;
  idempotencyKey: string;
}

/**
 * A pure lookup, no insert — lets the route (WO-233) decide whether this is a genuine idempotency
 * violation (or a pure replay) *before* running any side effect (`upsertReportedCommits`,
 * `recordBaselineHead`, `PgProjectEngine.refresh()`), instead of only discovering it at the very end via
 * `recordCodeReport`'s own `INSERT ... ON CONFLICT DO NOTHING`. This alone cannot fully prevent two
 * genuinely concurrent requests sharing a brand-new key from both running side effects once each (only
 * the final `recordCodeReport` insert's unique index actually serializes that race, same as before) —
 * but it does mean a *sequential* retry (the common case: a client retrying after a lost response) never
 * redoes a baseline write or graph refresh, and a genuine same-key-different-body violation is rejected
 * immediately rather than after wastefully repeating every side effect only to fail at the last step.
 */
export async function findCodeReportByIdempotencyKey(pool: Pool, input: FindCodeReportByIdempotencyKeyInput): Promise<CodeReportRecord | null> {
  return withTenantTx(pool, input.orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(codeReports)
      .where(and(eq(codeReports.projectId, input.projectId), eq(codeReports.tokenId, input.tokenId), eq(codeReports.idempotencyKey, input.idempotencyKey)));
    return existing ?? null;
  });
}

export async function recordCodeReport(pool: Pool, input: RecordCodeReportInput): Promise<RecordCodeReportOutcome> {
  return withTenantTx(pool, input.orgId, async (tx) => {
    const [inserted] = await tx
      .insert(codeReports)
      .values({
        projectId: input.projectId,
        orgId: input.orgId,
        tokenId: input.tokenId,
        idempotencyKey: input.idempotencyKey,
        bodySha256: input.bodySha256,
        mode: input.mode,
        headSha: input.headSha,
        result: input.result,
      })
      .onConflictDoNothing({ target: [codeReports.projectId, codeReports.tokenId, codeReports.idempotencyKey] })
      .returning();
    if (inserted) return { kind: 'created', record: inserted };

    const [existing] = await tx
      .select()
      .from(codeReports)
      .where(and(eq(codeReports.projectId, input.projectId), eq(codeReports.tokenId, input.tokenId), eq(codeReports.idempotencyKey, input.idempotencyKey)));
    if (!existing) throw new Error('code_reports: insert conflicted but no existing row was found');
    return existing.bodySha256 === input.bodySha256 ? { kind: 'replayed', record: existing } : { kind: 'mismatch', record: existing };
  });
}
