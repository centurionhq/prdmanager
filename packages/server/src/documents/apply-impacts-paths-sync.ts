/**
 * Single implementation of "apply a CI-derived `impacts_paths` suggestion to a published Blueprint"
 * (SDD-021 WO-430; shared with the MCP tool by SDD-119 D1/D2, WO-786). Both the REST route
 * (`../api/impacts-paths-sync.ts`) and the remote MCP port (`./remote-documents-port.ts`) delegate here, so
 * the echo comparison, merge, removals and audit row can never drift apart. Permission checks stay with the
 * callers; this layer returns data, never HTTP errors.
 */
import { createTenantDb } from '@prdm/db';
import type { Pool } from 'pg';
import { computeImpactsPathsDrift, computeImpactsPathsNarrowing } from '../engine/impacts-paths-drift.js';
import type { PgProjectEngine } from '../engine/pg-project-engine.js';

export type ImpactsPathsSyncOutcome =
  | { ok: true; impactsPaths: string[] }
  | { ok: false; code: 'suggestion_changed' | 'nothing_to_apply'; message: string };

export interface ImpactsPathsSyncDeps {
  pool: Pool;
  orgId: string;
  projectId: string;
  engine: PgProjectEngine;
}

export interface ImpactsPathsSyncInput {
  blueprintId: string;
  expectedSuggestion: readonly string[];
  expectedRemovals: readonly string[];
  reason: string;
  actorId: string;
  /** Only the REST route passes these today; the MCP port omits them. */
  ip?: string;
  userAgent?: string;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** `null` when `blueprintId` doesn't exist or isn't a Blueprint (callers map it to 404 / `not_found`). */
export async function applyImpactsPathsSync(deps: ImpactsPathsSyncDeps, input: ImpactsPathsSyncInput): Promise<ImpactsPathsSyncOutcome | null> {
  const { pool, orgId, projectId, engine } = deps;
  const { blueprintId, expectedSuggestion, expectedRemovals } = input;

  const { docs } = await engine.scan();
  const drift = await computeImpactsPathsDrift(pool, orgId, projectId, docs, blueprintId);
  const narrowing = await computeImpactsPathsNarrowing(pool, orgId, projectId, docs, blueprintId);
  if (!drift || !narrowing) return null;

  if (!sameSet(drift.suggestedAdditions, expectedSuggestion)) {
    return { ok: false, code: 'suggestion_changed', message: `${blueprintId}'s suggested impacts_paths additions changed since you last fetched them; reload and try again` };
  }
  if (!sameSet(narrowing.suggestedRemovals.map((r) => r.pattern), expectedRemovals)) {
    return { ok: false, code: 'suggestion_changed', message: `${blueprintId}'s suggested impacts_paths removals changed since you last fetched them; reload and try again` };
  }
  if (drift.suggestedAdditions.length === 0 && expectedRemovals.length === 0) {
    return { ok: false, code: 'nothing_to_apply', message: `${blueprintId} has no suggested impacts_paths additions to apply` };
  }

  const nextImpactsPaths = [...new Set([...drift.currentPatterns, ...drift.suggestedAdditions])].filter((p) => !expectedRemovals.includes(p)).sort();
  const applied = await engine.applyCiSuggestedImpactsPaths(blueprintId, nextImpactsPaths);

  await createTenantDb(pool)
    .forOrg(orgId)
    .auditLog.record({
      projectId,
      actorType: 'user',
      actorId: input.actorId,
      action: 'document.impacts_paths_synced',
      target: blueprintId,
      metadata: { reason: input.reason, added: drift.suggestedAdditions, removed: expectedRemovals, nextImpactsPaths },
      ip: input.ip,
      userAgent: input.userAgent,
    });

  return { ok: true, impactsPaths: applied.impactsPaths };
}
