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
import { codeReportResponseSchema } from '@prdm/contracts';
import { isGovernedPath, workOrdersImplementing, type ParsedDoc, type PolicyBlueprint } from '@prdm/core';
import { findCommitsReferencingAny, listCodeReports } from '@prdm/db';
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

/** SDD-072 D2: a pattern is "actually shared" once this many commits outside the blueprint's own Work Orders touch it. */
const MIN_FOREIGN_COMMITS_TO_NARROW = 3;
/** SDD-072 D2: ...or once this many blueprints (this one included) declare the exact same pattern. */
const MIN_DECLARING_BLUEPRINTS_TO_NARROW = 6;
const CODE_REPORTS_SCAN_LIMIT = 200;

export interface ImpactsPathsRemovalSuggestion {
  pattern: string;
  /** Paths (sorted) that foreign commits touched and that the pattern matches. */
  matchedPaths: readonly string[];
  /** Shas (sorted) of the foreign commits that touched at least one of `matchedPaths`. */
  foreignCommits: readonly string[];
  /** Ids (sorted) of the OTHER blueprints declaring exactly this pattern. */
  alsoDeclaredBy: readonly string[];
  /** `code_out_of_sync` issues attributed to this pattern across the project's stored code reports. */
  driftIssueCount: number;
}

export interface ImpactsPathsNarrowing {
  blueprintId: string;
  currentPatterns: readonly string[];
  /** Ordered by `pattern`. */
  suggestedRemovals: readonly ImpactsPathsRemovalSuggestion[];
  /** Shas (sorted) of the own + foreign commits considered. */
  basedOnCommits: readonly string[];
}

function patternMatches(type: 'SDD' | 'ADR', blueprintId: string, pattern: string, file: string): boolean {
  return isGovernedPath(file, [{ type, id: blueprintId, impactsPaths: [pattern] }]);
}

/** Targets of the `code_out_of_sync` issues attributed to `blueprintId` across every stored code report. */
async function codeOutOfSyncTargets(pool: Pool, orgId: string, projectId: string, blueprintId: string): Promise<string[]> {
  const rows = await listCodeReports(pool, { orgId, projectId, limit: CODE_REPORTS_SCAN_LIMIT });
  const targets: string[] = [];
  for (const row of rows) {
    const parsed = codeReportResponseSchema.safeParse(row.result);
    if (!parsed.success) continue;
    for (const issue of parsed.data.issues) {
      if (issue.kind === 'code_out_of_sync' && issue.nodeId === blueprintId && issue.target !== undefined) targets.push(issue.target);
    }
  }
  return targets;
}

/**
 * Inverse mirror of {@link computeImpactsPathsDrift} (SDD-072 D2, WO-642): which of the blueprint's current
 * `impacts_paths` patterns are surplus. A pattern is suggested for removal iff (a) no commit referencing
 * this blueprint's own Work Orders touched a file it matches, and (b) it is de-facto shared -- at least
 * {@link MIN_FOREIGN_COMMITS_TO_NARROW} foreign commits touch it, or {@link MIN_DECLARING_BLUEPRINTS_TO_NARROW}
 * blueprints (this one included) declare it verbatim. Read-only: applying a removal goes through the same
 * audited `sync` codepath as additions. A blueprint without Work Orders has no footprint, hence no evidence
 * that anything is surplus.
 */
export async function computeImpactsPathsNarrowing(pool: Pool, orgId: string, projectId: string, docs: readonly ParsedDoc[], blueprintId: string): Promise<ImpactsPathsNarrowing | null> {
  const blueprint = docs.find((d) => d.node.id === blueprintId && d.node.label === 'Blueprint');
  if (!blueprint) return null;

  const currentPatterns = blueprint.impactsPaths;
  const empty: ImpactsPathsNarrowing = { blueprintId, currentPatterns, suggestedRemovals: [], basedOnCommits: [] };
  const ownWoIds = workOrdersImplementing(docs, blueprintId).map((wo) => wo.node.id);
  if (ownWoIds.length === 0) return empty;

  const ownWoIdSet = new Set(ownWoIds);
  const otherBlueprints = docs.filter((d) => d.node.label === 'Blueprint' && d.node.id !== blueprintId);
  const foreignWoIds = [...new Set(otherBlueprints.flatMap((bp) => workOrdersImplementing(docs, bp.node.id).map((wo) => wo.node.id)))].filter((id) => !ownWoIdSet.has(id));

  const ownCommits = await findCommitsReferencingAny(pool, orgId, projectId, ownWoIds);
  const ownShas = new Set(ownCommits.map((c) => c.sha));
  const foreignCommits = foreignWoIds.length === 0 ? [] : (await findCommitsReferencingAny(pool, orgId, projectId, foreignWoIds)).filter((c) => !ownShas.has(c.sha));

  const type = blueprint.frontmatter.type as 'SDD' | 'ADR';
  const ownFiles = new Set(ownCommits.flatMap((c) => c.files));
  const driftTargets = await codeOutOfSyncTargets(pool, orgId, projectId, blueprintId);

  const suggestedRemovals: ImpactsPathsRemovalSuggestion[] = [];
  for (const pattern of [...currentPatterns].sort()) {
    if ([...ownFiles].some((file) => patternMatches(type, blueprintId, pattern, file))) continue;

    const touching = foreignCommits.filter((c) => c.files.some((file) => patternMatches(type, blueprintId, pattern, file)));
    const alsoDeclaredBy = otherBlueprints.filter((bp) => bp.impactsPaths.includes(pattern)).map((bp) => bp.node.id).sort();
    const isShared = touching.length >= MIN_FOREIGN_COMMITS_TO_NARROW || alsoDeclaredBy.length + 1 >= MIN_DECLARING_BLUEPRINTS_TO_NARROW;
    if (!isShared) continue;

    const matchedPaths = [...new Set(touching.flatMap((c) => c.files).filter((file) => patternMatches(type, blueprintId, pattern, file)))].sort();
    suggestedRemovals.push({
      pattern,
      matchedPaths,
      foreignCommits: touching.map((c) => c.sha).sort(),
      alsoDeclaredBy,
      driftIssueCount: driftTargets.filter((target) => patternMatches(type, blueprintId, pattern, target)).length,
    });
  }

  const basedOnCommits = [...new Set([...ownShas, ...foreignCommits.map((c) => c.sha)])].sort();
  return { blueprintId, currentPatterns, suggestedRemovals, basedOnCommits };
}
