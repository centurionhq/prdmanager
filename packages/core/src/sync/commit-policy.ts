import picomatch from 'picomatch';
import type { WorkOrderStatus } from '../domain/schema.js';
import { parseRefs } from './git.js';

/** WO statuses SDD-002 "Ciclo de vida" considers open for the purpose of `Refs:` enforcement. */
export const OPEN_WO_STATUSES: readonly WorkOrderStatus[] = ['pending', 'in_progress', 'out_of_sync'];
const MAX_LISTED_PATHS = 10;

export interface PolicyBlueprint {
  type: 'SDD' | 'ADR';
  id: string;
  impactsPaths: readonly string[];
}

export interface PolicyWorkOrder {
  type: 'WO';
  id: string;
  status: WorkOrderStatus;
  implements: readonly string[];
}

export type PolicyDoc = PolicyBlueprint | PolicyWorkOrder;

const isBlueprint = (doc: PolicyDoc): doc is PolicyBlueprint => doc.type === 'SDD' || doc.type === 'ADR';
const isWorkOrder = (doc: PolicyDoc): doc is PolicyWorkOrder => doc.type === 'WO';
const isOpen = (status: WorkOrderStatus): boolean => (OPEN_WO_STATUSES as readonly string[]).includes(status);

export interface EvaluateCommitSettings {
  enforceRefs: boolean;
  /** `true` when `git.enforce_refs_since` is unset, or the commit under evaluation descends from it (computed by the caller). */
  isWithinEnforcementRange: boolean;
}

export interface EvaluateCommitInput {
  changedPaths: readonly string[];
  message: string;
  isMerge: boolean;
  /** Only meaningful for merges: were any of the conflicts this merge resolved inside governed code? */
  hasConflictsInGoverned: boolean;
  /** Every SDD/ADR/WO document as it exists at `HEAD`. */
  docsAtHead: readonly PolicyDoc[];
  /** Every SDD/ADR/WO document as it exists in the index (the about-to-be-committed tree). */
  docsInIndex: readonly PolicyDoc[];
  settings: EvaluateCommitSettings;
}

export interface EvaluateCommitResult {
  ok: boolean;
  message?: string;
  /** Governed paths this commit touches (empty when there is nothing to enforce), capped at {@link MAX_LISTED_PATHS} in `message` but not here. */
  requiredFor: readonly string[];
  refs: readonly string[];
}

/** A blueprint's `impacts_paths` pattern, with any `#symbol` suffix stripped: policy matching is file-level only. */
function stripSymbol(pattern: string): string {
  const hashIndex = pattern.indexOf('#');
  return hashIndex === -1 ? pattern : pattern.slice(0, hashIndex);
}

interface PatternRef {
  blueprintId: string;
  isMatch: picomatch.Matcher;
}

/** Union of HEAD's and the index's `impacts_paths`, so shrinking a blueprint's own governed set in the index cannot exempt an in-flight change. */
function governedPatterns(docs: readonly PolicyDoc[]): PatternRef[] {
  return docs.filter(isBlueprint).flatMap((doc) => doc.impactsPaths.map((pattern): PatternRef => ({ blueprintId: doc.id, isMatch: picomatch(stripSymbol(pattern)) })));
}

/** Whether any blueprint in `docs` (from either HEAD or the index — callers pass the union) governs `path`. */
export function isGovernedPath(path: string, docs: readonly PolicyDoc[]): boolean {
  return governedPatterns(docs).some((pattern) => pattern.isMatch(path));
}

/** Blueprint id -> the changed paths it governs, using the union of every pattern seen at HEAD and in the index. */
function touchedByBlueprint(changedPaths: readonly string[], patterns: readonly PatternRef[]): Map<string, Set<string>> {
  const touched = new Map<string, Set<string>>();
  for (const path of changedPaths) {
    for (const pattern of patterns) {
      if (!pattern.isMatch(path)) continue;
      const set = touched.get(pattern.blueprintId) ?? new Set<string>();
      set.add(path);
      touched.set(pattern.blueprintId, set);
    }
  }
  return touched;
}

/** Last-wins map of work orders found in a single document list (a ref normally has at most one file per WO id). */
function workOrdersById(docs: readonly PolicyDoc[]): Map<string, PolicyWorkOrder> {
  const byId = new Map<string, PolicyWorkOrder>();
  for (const doc of docs.filter(isWorkOrder)) byId.set(doc.id, doc);
  return byId;
}

function governsAny(wo: PolicyWorkOrder, blueprintIds: ReadonlySet<string>): boolean {
  return wo.implements.some((bp) => blueprintIds.has(bp));
}

/** Blueprint ids from `docs` that govern `path` (union of every blueprint occurrence in `docs`, per {@link isGovernedPath}). */
function blueprintsGoverning(path: string, docs: readonly PolicyDoc[]): Set<string> {
  return new Set(
    governedPatterns(docs)
      .filter((pattern) => pattern.isMatch(path))
      .map((pattern) => pattern.blueprintId),
  );
}

/**
 * Whether `refs` names a work order that is open *somewhere* in `docs` and governs `path`. Used by
 * `checkCommitRange`'s range-wide aggregate coverage check (WO-024 finding 1d), where `docs` is the union of every
 * ref inspected across the range rather than a single HEAD/index pair, so a WO id may appear more than once with
 * different statuses: any occurrence being open and governing is enough.
 */
export function isPathCoveredByRefs(path: string, refs: readonly string[], docs: readonly PolicyDoc[]): boolean {
  const blueprintIds = blueprintsGoverning(path, docs);
  if (blueprintIds.size === 0) return false;
  return refs.some((id) => docs.some((doc) => isWorkOrder(doc) && doc.id === id && isOpen(doc.status) && governsAny(doc, blueprintIds)));
}

function buildMessage(paths: readonly string[], refs: readonly string[], candidates: readonly string[]): string {
  const shown = paths.slice(0, MAX_LISTED_PATHS).join(', ');
  const more = paths.length > MAX_LISTED_PATHS ? ` (+${paths.length - MAX_LISTED_PATHS} more)` : '';
  const candidateText = candidates.length > 0 ? `candidate open work orders: ${candidates.join(', ')}` : 'no open work order governs these paths';
  const refsText = refs.length > 0 ? `; "Refs:" named ${refs.join(', ')}, but none is an open work order governing these paths` : '';
  return `commit touches governed path(s) ${shown}${more} without a "Refs: WO-xxx" trailer naming an open work order of a blueprint that governs them (${candidateText})${refsText}.`;
}

/**
 * Pure evaluation of SDD-002 "Ciclo de vida" § Ejecución / ADR-002 D16: a commit that touches code governed by an
 * `SDD`/`ADR` must carry a `Refs: WO-xxx` trailer naming a work order of this project that is `pending`,
 * `in_progress` or `out_of_sync`, and that `implements` a blueprint governing at least one touched path.
 */
export function evaluateCommit(input: EvaluateCommitInput): EvaluateCommitResult {
  const patterns = [...governedPatterns(input.docsAtHead), ...governedPatterns(input.docsInIndex)];
  const touched = touchedByBlueprint(input.changedPaths, patterns);
  const touchedPaths = [...new Set([...touched.values()].flatMap((set) => [...set]))].sort();
  if (touchedPaths.length === 0) return { ok: true, requiredFor: [], refs: [] };

  const exempt = !input.settings.enforceRefs || (input.isMerge && !input.hasConflictsInGoverned) || !input.settings.isWithinEnforcementRange;
  if (exempt) return { ok: true, requiredFor: touchedPaths, refs: [] };

  const refs = parseRefs(input.message);
  const governingBlueprints = new Set(touched.keys());
  // A WO open at HEAD *or* in the index satisfies the policy (WO-024 finding 6): marking a work order done in the
  // very commit that closes it out must not retroactively invalidate that commit's own "Refs:" trailer.
  const atHead = workOrdersById(input.docsAtHead);
  const inIndex = workOrdersById(input.docsInIndex);
  const isOpenAndGoverning = (wo: PolicyWorkOrder | undefined): boolean => wo !== undefined && isOpen(wo.status) && governsAny(wo, governingBlueprints);
  const isValidRef = (id: string): boolean => isOpenAndGoverning(atHead.get(id)) || isOpenAndGoverning(inIndex.get(id));
  if (refs.some(isValidRef)) return { ok: true, requiredFor: touchedPaths, refs };

  const candidateIds = new Set([...atHead.keys(), ...inIndex.keys()]);
  const candidates = [...candidateIds].filter((id) => isOpenAndGoverning(atHead.get(id)) || isOpenAndGoverning(inIndex.get(id))).sort();
  return { ok: false, message: buildMessage(touchedPaths, refs, candidates), requiredFor: touchedPaths, refs };
}
