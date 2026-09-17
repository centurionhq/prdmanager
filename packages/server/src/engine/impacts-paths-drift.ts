/**
 * `impacts_paths` CI-derived drift computation (SDD-021 "Reconciliacion de impacts_paths desde CI",
 * WO-427): for a Blueprint (SDD/ADR), unions the `files[]` of every stored commit (any trust level --
 * `commits.files` is a genuinely independent signal, unlike `project_code_refs`, which is itself a
 * glob-expansion of the blueprint's *already-declared* `impacts_paths` and so can never surface a
 * pattern gap) whose `refs[]` names a Work Order that `implements` this blueprint, then tests each file
 * against the blueprint's *current* `impacts_paths` patterns with the same pure matcher
 * `commit-policy.ts`'s own enforcement already uses. Files touched under this blueprint's own Work
 * Orders but not covered by any current pattern are the suggested addition -- exactly the shape of the
 * SDD-016 incident this whole PRD traces back to (a missing `/**` suffix silently never matched
 * subdirectory files).
 *
 * Read-only and side-effect-free: this module only computes a suggestion. Applying it is a separate,
 * admin-gated, audited codepath (`applyCiSuggestedImpactsPaths`, WO-429) that a caller must explicitly
 * invoke after a human (or an agent acting on their behalf) reviews the suggestion -- never automatic,
 * since the SDD-016 incident was itself a silent, undetected error and auto-applying a CI-derived diff
 * without review risks the same class of failure in the other direction (e.g. a file touched by an
 * unrelated commit that happened to carry the wrong `Refs:` trailer).
 */
import { isGovernedPath, workOrdersImplementing, type ParsedDoc, type PolicyBlueprint } from '@prdm/core';
import { findCommitsReferencingAny } from '@prdm/db';
import type { Pool } from 'pg';

export interface ImpactsPathsDrift {
  blueprintId: string;
  currentPatterns: readonly string[];
  /** Files touched by a commit referencing one of this blueprint's Work Orders, but not matched by any
   * of `currentPatterns` -- sorted for a stable, deterministic result. */
  suggestedAdditions: readonly string[];
  /** The commit shas the suggestion is based on, for traceability. */
  basedOnCommits: readonly string[];
}

/**
 * `docs` is the caller's own already-fetched `scan().docs` (never re-scanned here) -- `reconcileByHash`
 * (WO-428) already has it in hand every refresh, and a REST/MCP caller (WO-430/431) fetches it once per
 * request the same way every other read tool does. `null` when `blueprintId` doesn't exist or isn't a
 * Blueprint (caller returns 404).
 */
export async function computeImpactsPathsDrift(pool: Pool, orgId: string, projectId: string, docs: readonly ParsedDoc[], blueprintId: string): Promise<ImpactsPathsDrift | null> {
  const blueprint = docs.find((d) => d.node.id === blueprintId && d.node.label === 'Blueprint');
  if (!blueprint) return null;

  const currentPatterns = blueprint.impactsPaths;
  const woIds = workOrdersImplementing(docs, blueprintId).map((wo) => wo.node.id);
  if (woIds.length === 0) return { blueprintId, currentPatterns, suggestedAdditions: [], basedOnCommits: [] };

  const relevantCommits = await findCommitsReferencingAny(pool, orgId, projectId, woIds);
  if (relevantCommits.length === 0) return { blueprintId, currentPatterns, suggestedAdditions: [], basedOnCommits: [] };

  const allFiles = new Set<string>();
  for (const commit of relevantCommits) for (const file of commit.files) allFiles.add(file);

  const policyBlueprint: PolicyBlueprint = { type: blueprint.frontmatter.type as 'SDD' | 'ADR', id: blueprintId, impactsPaths: currentPatterns };
  const suggestedAdditions = [...allFiles].filter((file) => !isGovernedPath(file, [policyBlueprint])).sort();

  return { blueprintId, currentPatterns, suggestedAdditions, basedOnCommits: relevantCommits.map((c) => c.sha).sort() };
}
