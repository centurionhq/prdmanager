/**
 * `force_push_overrides` repository (SDD-010 "Modo baseline de code-reports", WO-181): a project admin
 * authorizes one specific `head_sha`; the baseline gate consumes it (deletes it) the first time a
 * matching report actually uses it, so a stale override can never authorize a later, unrelated
 * force-push. `consume` is a single `DELETE ... RETURNING`, which is what makes "consume exactly once"
 * safe under concurrency: two racing reports for the same `head_sha` can both attempt to delete the
 * same row, but only one `DELETE` ever actually removes it and gets a row back.
 */
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { forcePushOverrides } from './schema/force-push-overrides.js';
import { withTenantTx } from './tenant.js';

export interface CreateForcePushOverrideInput {
  projectId: string;
  orgId: string;
  headSha: string;
  authorizedBy: string;
}

export async function createForcePushOverride(pool: Pool, input: CreateForcePushOverrideInput): Promise<void> {
  await withTenantTx(pool, input.orgId, (tx) =>
    tx
      .insert(forcePushOverrides)
      .values({ projectId: input.projectId, orgId: input.orgId, headSha: input.headSha, authorizedBy: input.authorizedBy })
      .onConflictDoNothing({ target: [forcePushOverrides.projectId, forcePushOverrides.headSha] }),
  );
}

/** Atomically consumes (deletes) the override for `(projectId, headSha)`, if one exists; returns
 * whether one was actually consumed. Safe to call speculatively — a report that turns out not to need
 * an override simply never calls this. */
export async function consumeForcePushOverride(pool: Pool, orgId: string, projectId: string, headSha: string): Promise<boolean> {
  return withTenantTx(pool, orgId, async (tx) => {
    const deleted = await tx
      .delete(forcePushOverrides)
      .where(and(eq(forcePushOverrides.projectId, projectId), eq(forcePushOverrides.headSha, headSha)))
      .returning({ id: forcePushOverrides.id });
    return deleted.length > 0;
  });
}
