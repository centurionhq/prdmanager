/**
 * `commits` repository (SDD-010 "Commits reportados con nivel de confianza", WO-181/WO-182): upserts
 * commits from a code-report with the trust precedence SDD-010 requires — "un reporte baseline
 * reemplaza el mensaje y las refs de uno preview; nunca al revés". Both directions share one
 * `INSERT ... ON CONFLICT (project_id, sha) DO UPDATE` per commit, built with the drizzle query
 * builder (never a raw `sql` template for the array columns themselves — `sql` tagged templates
 * interpolate a plain JS array as a parenthesized value list for an `IN (...)`-style clause, not as a
 * Postgres array literal, which is exactly wrong here; `.values({ refs: [...] })` goes through the
 * column's own array type and node-postgres's normal array binding instead):
 *  - `trust: 'baseline'` always overwrites every field (a CI-verified report is authoritative,
 *    regardless of what a previous preview report guessed).
 *  - `trust: 'preview'` carries `setWhere: trust <> 'baseline'` on its own `onConflictDoUpdate` —
 *    Postgres only applies the update when that holds, so a preview report can never downgrade or
 *    overwrite an already-baseline row's message/refs/trust, no matter what it claims (WO-182's
 *    "commit falsificado por un developer" case: a personal/non-CI token's report is always written
 *    with `trust: 'preview'` by its caller — this repository has no way to be told "trust me, this one
 *    is baseline" from request data, only from the caller's own already-verified decision).
 * `first_seen_at` is set once, at insertion, and never listed in either `set` clause — an
 * `ON CONFLICT DO UPDATE` that never names a column simply leaves it as-is (SDD-010: policy is
 * evaluated at a commit's *first* recorded sighting, not whenever it was last (re-)reported).
 */
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { decodeCursor, paginateKeyset } from './pagination.js';
import { commits } from './schema/documents.js';
import { withTenantTx } from './tenant.js';

export type CommitRecord = typeof commits.$inferSelect;

const DEFAULT_LIST_COMMITS_LIMIT = 50;

export interface ListCommitsInput {
  projectId: string;
  orgId: string;
  limit?: number;
  cursor?: string | null;
  /** Restricts to commits reported on this branch (WO-341, SDD-012) — a plain `@>` containment check
   * against the `branches` array column, the same "reported on more than one branch over time" set
   * `upsertReportedCommits`'s own `branchesUnion` maintains. */
  ref?: string;
}

export interface ListCommitsPage {
  items: CommitRecord[];
  nextCursor: string | null;
}

export interface ReportedCommitInput {
  sha: string;
  author: string;
  /** ISO 8601 */
  date: string;
  subject: string;
  refs: string[];
  files: string[];
}

export interface UpsertReportedCommitsInput {
  projectId: string;
  orgId: string;
  tokenId: string;
  trust: 'baseline' | 'preview';
  branch: string;
  commits: readonly ReportedCommitInput[];
}

export async function upsertReportedCommits(pool: Pool, input: UpsertReportedCommitsInput): Promise<void> {
  if (input.commits.length === 0) return;

  await withTenantTx(pool, input.orgId, async (tx) => {
    for (const commit of input.commits) {
      const values = {
        projectId: input.projectId,
        orgId: input.orgId,
        sha: commit.sha,
        trust: input.trust,
        reporterTokenId: input.tokenId,
        author: commit.author,
        date: new Date(commit.date),
        subject: commit.subject,
        refs: commit.refs,
        files: commit.files,
        branches: [input.branch],
      };
      // Union with whatever branches were already recorded, deduplicated — a commit can legitimately
      // be reported on more than one branch over time (e.g. cherry-picked, or merged later).
      const branchesUnion = sql`(SELECT array_agg(DISTINCT b) FROM unnest(${commits.branches} || ARRAY[${input.branch}]::text[]) AS b)`;

      if (input.trust === 'baseline') {
        await tx
          .insert(commits)
          .values(values)
          .onConflictDoUpdate({
            target: [commits.projectId, commits.sha],
            set: {
              trust: 'baseline',
              reporterTokenId: values.reporterTokenId,
              author: values.author,
              date: values.date,
              subject: values.subject,
              refs: values.refs,
              files: values.files,
              branches: branchesUnion,
            },
          });
      } else {
        await tx
          .insert(commits)
          .values(values)
          .onConflictDoUpdate({
            target: [commits.projectId, commits.sha],
            set: {
              reporterTokenId: values.reporterTokenId,
              author: values.author,
              date: values.date,
              subject: values.subject,
              refs: values.refs,
              files: values.files,
              branches: branchesUnion,
            },
            setWhere: sql`${commits.trust} <> 'baseline'`,
          });
      }
    }
  });
}

/** Newest-first (by commit `date`, `sha` as tiebreaker) paginated listing for one project (SDD-012, WO-332). */
export async function listCommits(pool: Pool, input: ListCommitsInput): Promise<ListCommitsPage> {
  const limit = input.limit ?? DEFAULT_LIST_COMMITS_LIMIT;
  const cursor = decodeCursor(input.cursor);

  return withTenantTx(pool, input.orgId, async (tx) => {
    const conditions = [eq(commits.projectId, input.projectId)];
    if (cursor) {
      conditions.push(or(lt(commits.date, cursor.timestamp), and(eq(commits.date, cursor.timestamp), lt(commits.sha, cursor.id))!)!);
    }
    if (input.ref) conditions.push(sql`${commits.branches} @> ARRAY[${input.ref}]::text[]`);
    const rows = await tx
      .select()
      .from(commits)
      .where(and(...conditions))
      .orderBy(desc(commits.date), desc(commits.sha))
      .limit(limit + 1);
    return paginateKeyset(rows, limit, (row) => ({ timestamp: row.date, id: row.sha }));
  });
}
