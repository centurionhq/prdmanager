import { MISSING_SECTIONS_MESSAGE, missingSections } from '../domain/required-sections.js';
import type { ParsedDoc } from '../domain/schema.js';
import type { GrandfatheredDoc } from '../project/types.js';
import type { DriftIssue } from '../sync/monitor.js';

export interface LifecycleContext {
  /** Pre-PRD-002 documents exempt while their content hash is unchanged (ADR-002 D13). */
  grandfathered: readonly GrandfatheredDoc[];
  /**
   * `publish` turns the PRD/FR section rules (SDD-124) into errors; the default `edit` only warns, so drift and
   * draft validation enumerate incomplete documents without blocking them (PRD-044 §Despliegue).
   */
  mode?: 'edit' | 'publish';
}

type FeatureDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'MRD' | 'PRD' | 'FR' }> };
type BlueprintDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'SDD' | 'ADR' }> };
type WorkOrderDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'WO' }> };
type ArtifactDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'ART' }> };
type FeedbackDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'FB' }> };
type BusinessCaseDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'BC' }> };

const TASKS_HEADING = /^##\s+(Tareas|Tasks)\s*$/im;
const NEXT_HEADING = /^##\s+.+$/m;
const CHECKLIST_LINE = /^[-*]\s*\[[ xX]\]/;

/**
 * SDD-125 D2 (R3): the single declared passage exception, read as data from the FR body's own
 * `## Excepción de pasaje` section. PRD-044 is explicit that it is "dato, no permiso implícito": an empty
 * section (no reason) is *not* an exception and does not exempt the FR from declaring its PRD, and it never
 * replaces the BC gate. Severity is always `info`: it is counted and shown, never blocking -- the count is
 * what the capacities panel reads, so a visible exception never becomes hidden debt.
 */
export interface PassageException {
  kind: 'passage_exception';
  severity: 'info';
  nodeId: string;
  /** The non-empty line of the section, with any leading list/quote marker stripped. */
  reason: string;
  message: string;
}

const PASSAGE_EXCEPTION_HEADING = /^##\s+Excepción de pasaje\s*$/im;

/** The declared passage exception of a Feature Request, or `null` (absent section, empty section, or any
 * other document kind -- R3's exception is FR-only). */
export function passageException(doc: ParsedDoc): PassageException | null {
  if (doc.frontmatter.type !== 'FR') return null;
  const body = doc.node.body;
  const heading = PASSAGE_EXCEPTION_HEADING.exec(body);
  if (!heading) return null;
  const rest = body.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  const line = section
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  if (line === undefined) return null;
  const reason = line.replace(/^[-*]\s+/, '').replace(/^>\s*/, '').trim();
  if (reason.length === 0) return null;
  return {
    kind: 'passage_exception',
    severity: 'info',
    nodeId: doc.node.id,
    reason,
    message: `${doc.node.id} declares a passage exception (R3): "${reason}"`,
  };
}

/** Every declared passage exception among `docs` -- the indicator the capacities panel counts (SDD-126). */
export function passageExceptions(docs: readonly ParsedDoc[]): PassageException[] {
  return docs.map(passageException).filter((exception): exception is PassageException => exception !== null);
}

/** How many documents declare the R3 exception. */
export function countPassageExceptions(docs: readonly ParsedDoc[]): number {
  return passageExceptions(docs).length;
}

/** True when `body` has a `## Tareas`/`## Tasks` heading whose section contains at least one `- [ ]`/`- [x]` line. */
function hasTasksChecklist(body: string): boolean {
  const heading = TASKS_HEADING.exec(body);
  if (!heading) return false;
  const rest = body.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  return section.split('\n').some((line) => CHECKLIST_LINE.test(line.trim()));
}

function violation(nodeId: string, severity: DriftIssue['severity'], message: string, kind: DriftIssue['kind'] = 'lifecycle_violation'): DriftIssue {
  return { kind, severity, nodeId, message };
}

/** SDD-096 D1: a Feedback is linked when any MRD/PRD/FR/BC cites it in `justified_by` (the inverse of `hasJustification`). */
function isCitedByJustifiedBy(id: string, docs: readonly ParsedDoc[]): boolean {
  return docs.some((d) => {
    const fm = d.frontmatter;
    if (fm.type !== 'MRD' && fm.type !== 'PRD' && fm.type !== 'FR' && fm.type !== 'BC') return false;
    return (fm.justified_by ?? []).includes(id);
  });
}

/** SDD-096 D2: a terminal status counts as resolved only when it carries the trace field `link.ts` always writes with it. */
function hasTerminalOutcome(fm: FeedbackDoc['frontmatter']): boolean {
  switch (fm.status) {
    case 'closed':
      return !!fm.close_reason && fm.closed_by !== undefined;
    case 'duplicate':
      return fm.duplicate_of !== undefined;
    case 'dismissed':
      return !!fm.dismiss_reason;
    default:
      return false;
  }
}

function checkFeedback(doc: FeedbackDoc, docs: readonly ParsedDoc[]): DriftIssue[] {
  const fm = doc.frontmatter;
  if (fm.informs.length > 0 || fm.root) return [];
  if (isCitedByJustifiedBy(doc.node.id, docs) || hasTerminalOutcome(fm)) return [];
  const exits = `link it via "informs", mark "root: true", get cited in a "justified_by", close it with a "close_reason", or mark it a duplicate via "duplicate_of"`;
  return fm.status === 'new'
    ? [violation(doc.node.id, 'warning', `${doc.node.id} is still untriaged: ${exits} before it can justify a feature`)]
    : [violation(doc.node.id, 'error', `${doc.node.id} must link to a feature via "informs" (or: mark "root: true", get cited in a "justified_by", close it with a "close_reason", or mark it a duplicate via "duplicate_of")`)];
}

function checkArtifact(doc: ArtifactDoc): DriftIssue[] {
  const fm = doc.frontmatter;
  if (fm.provides_context_for.length > 0 || fm.root) return [];
  return [violation(doc.node.id, 'error', `${doc.node.id} must link to a feature via "provides_context_for" (or be marked "root: true")`)];
}

/**
 * A Feature is justified either by its own explicit `justified_by` (even if one of those ids turns out to be
 * broken — that is already reported as `broken_link`/`invalid_link_target` by `linkIssues`, so it is not
 * double-counted here) or by any Feedback/Artifact that points back to it via `informs`/`provides_context_for`.
 */
function hasJustification(doc: FeatureDoc | BusinessCaseDoc, docs: readonly ParsedDoc[]): boolean {
  if ((doc.frontmatter.justified_by ?? []).length > 0) return true;
  return docs.some((d) => {
    if (d.frontmatter.type === 'FB') return d.frontmatter.informs.includes(doc.node.id);
    if (d.frontmatter.type === 'ART') return d.frontmatter.provides_context_for.includes(doc.node.id);
    return false;
  });
}

function justifyingBusinessCase(doc: FeatureDoc, byId: Map<string, ParsedDoc>): BusinessCaseDoc | null {
  for (const id of doc.frontmatter.justified_by ?? []) {
    const candidate = byId.get(id);
    if (candidate?.frontmatter.type === 'BC') return candidate as BusinessCaseDoc;
  }
  return null;
}

/** SDD-125 D1 (R3): the PRD a Feature Request declares as its parent -- same first-match lookups as
 * {@link justifyingBusinessCase}, on the same `justified_by` list (full lineage: BC *and* PRD). */
function justifyingPrd(doc: FeatureDoc, byId: Map<string, ParsedDoc>): FeatureDoc | null {
  for (const id of doc.frontmatter.justified_by ?? []) {
    const candidate = byId.get(id);
    if (candidate?.frontmatter.type === 'PRD') return candidate as FeatureDoc;
  }
  return null;
}

/**
 * PRD-011 §4.2/SDD-023 (WO-439), widened to `FR` by SDD-025 (WO-448) after verifying against real project
 * data that a top-level FR with no parent PRD is just as invisible to the old gate as a PRD was --
 * narrows the justification rule for PRD/FR: their justification must resolve to a BC (Caso de Negocio)
 * in "approved"/"closed" status, not any FB/ART like MRD still accepts. Three distinguishable failures, so
 * the message always names exactly what is missing: no justification at all, justified but not by a BC,
 * or a BC linked but not yet approved.
 *
 * SDD-125 D1 (R3): the gate *composes* with, never replaces, that rule. An `FR` additionally declares its
 * PRD in the same `justified_by` (full lineage: BC and PRD), and the PRD must be approved/closed too.
 * That adds two distinguishable failures of its own (no PRD linked / PRD not approved), so all five FR
 * failures keep their own message. They are errors when publishing -- PRD-044's two-step rollout: the new
 * requirement is first enumerated as a warning everywhere (drift, `edit` mode) and only blocks at publish,
 * exactly like the section rules of SDD-124 -- while the three pre-existing BC failures keep their own
 * (always blocking) severity untouched.
 */
function checkFeatureBusinessCase(doc: FeatureDoc, docs: readonly ParsedDoc[], byId: Map<string, ParsedDoc>, mode: 'edit' | 'publish'): DriftIssue[] {
  const bc = justifyingBusinessCase(doc, byId);
  if (!bc) {
    if (!hasJustification(doc, docs)) {
      return [violation(doc.node.id, 'error', `${doc.node.id} needs a "justified_by" link to an approved (or closed) BC (Caso de Negocio) before it can generate work orders`)];
    }
    return [violation(doc.node.id, 'error', `${doc.node.id} is justified, but not by a BC (Caso de Negocio): link one via "justified_by"`)];
  }
  if (bc.node.status !== 'approved' && bc.node.status !== 'closed') {
    return [violation(doc.node.id, 'error', `${doc.node.id}'s business case ${bc.node.id} is not yet "approved"/"closed" (currently "${bc.node.status}")`)];
  }
  if (doc.frontmatter.type !== 'FR') return [];
  const severity = mode === 'publish' ? 'error' : 'warning';
  const prd = justifyingPrd(doc, byId);
  // SDD-125 D2: the single declared exception (a non-empty `## Excepción de pasaje` reason) accepts the FR
  // without a PRD. It is read as data; it never exempts the BC rule above, and an empty section is no exception.
  if (!prd) {
    if (passageException(doc) !== null) return [];
    return [
      violation(
        doc.node.id,
        severity,
        `${doc.node.id} is justified, but not by a PRD: link one via "justified_by" (or declare "## Excepción de pasaje" when its whole scope is a single change)`,
      ),
    ];
  }
  if (prd.node.status !== 'approved' && prd.node.status !== 'closed') {
    return [violation(doc.node.id, severity, `${doc.node.id}'s PRD ${prd.node.id} is not yet "approved"/"closed" (currently "${prd.node.status}")`)];
  }
  return [];
}

const ACCEPTANCE_HEADING = '## Criterio de aceptación';

/** True when the `## Criterio de aceptación` section holds at least one `- [ ]`/`- [x]` line. */
function hasAcceptanceItem(body: string): boolean {
  const lines = body.split('\n').map((line) => line.trim());
  const start = lines.indexOf(ACCEPTANCE_HEADING);
  if (start < 0) return false;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => NEXT_HEADING.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).some((line) => CHECKLIST_LINE.test(line));
}

function checkPrd(doc: FeatureDoc, severity: DriftIssue['severity']): DriftIssue[] {
  const missing = missingSections('PRD', doc.node.body);
  return missing.length > 0 ? [violation(doc.node.id, severity, MISSING_SECTIONS_MESSAGE(doc.node.id, missing))] : [];
}

function checkFeatureRequest(doc: FeatureDoc, severity: DriftIssue['severity']): DriftIssue[] {
  const missing = missingSections('FR', doc.node.body);
  if (missing.length > 0) return [violation(doc.node.id, severity, MISSING_SECTIONS_MESSAGE(doc.node.id, missing))];
  if (hasAcceptanceItem(doc.node.body)) return [];
  return [violation(doc.node.id, severity, `${doc.node.id} needs at least one verifiable item (a "- [ ]" or "- [x]" line) under "${ACCEPTANCE_HEADING}"`)];
}

/**
 * SDD-125 D3 (R4, "nada queda sin descendencia"): an approved/closed PRD or FR needs at least one blueprint
 * that architects it. Emitted as a `warning` -- it is a hole the line must show, not a publish blocker (a
 * feature is approved *before* its design exists) -- and attributed to `diseno_tecnico` by
 * `../sync/issue-attribution.js`, where it also stops the line. Never applies to a BC: a business case's
 * descendant is a PRD/FR, not a blueprint.
 */
function checkFeatureDesign(doc: FeatureDoc, docs: readonly ParsedDoc[]): DriftIssue[] {
  if (doc.node.status !== 'approved' && doc.node.status !== 'closed') return [];
  const architected = docs.some((d) => d.node.label === 'Blueprint' && d.edges.some((e) => e.type === 'ARCHITECTS' && e.to === doc.node.id));
  if (architected) return [];
  return [
    violation(
      doc.node.id,
      'warning',
      `${doc.node.id} is approved but has no blueprint architecting it: it needs a design (SDD/ADR) that declares it in "architects" before it can reach planning`,
      'feature_without_blueprint',
    ),
  ];
}

function checkFeature(doc: FeatureDoc, docs: readonly ParsedDoc[], byId: Map<string, ParsedDoc>, mode: 'edit' | 'publish'): DriftIssue[] {
  const severity = mode === 'publish' ? 'error' : 'warning';
  if (doc.frontmatter.type === 'PRD') return [...checkFeatureBusinessCase(doc, docs, byId, mode), ...checkPrd(doc, severity), ...checkFeatureDesign(doc, docs)];
  if (doc.frontmatter.type === 'FR')
    return [...checkFeatureBusinessCase(doc, docs, byId, mode), ...checkFeatureRequest(doc, severity), ...checkFeatureDesign(doc, docs)];
  if (hasJustification(doc, docs)) return [];
  return [
    violation(
      doc.node.id,
      'error',
      `${doc.node.id} has no justification: link an existing Feedback or Artifact via "justified_by" (or have one point back to it via "informs"/"provides_context_for")`,
    ),
  ];
}

/**
 * PRD-011 §4.2/SDD-023: a BC is justified exactly like MRD/PRD/FR (reuses `hasJustification`, not a
 * separate rule), plus its own body-content gate -- the four required sections. Unlike a blueprint, a
 * BC never needs `impacts_paths`: it is not a blueprint (see `businessCaseSchema`'s own doc comment).
 */
function checkBusinessCase(doc: BusinessCaseDoc, docs: readonly ParsedDoc[]): DriftIssue[] {
  const issues: DriftIssue[] = [];
  if (!hasJustification(doc, docs)) {
    issues.push(
      violation(
        doc.node.id,
        'error',
        `${doc.node.id} has no justification: link an existing Feedback or Artifact via "justified_by" (or have one point back to it via "informs"/"provides_context_for")`,
      ),
    );
  }
  const missing = missingSections('BC', doc.node.body);
  if (missing.length > 0) {
    issues.push(violation(doc.node.id, 'error', MISSING_SECTIONS_MESSAGE(doc.node.id, missing)));
  }
  return issues;
}

function checkBlueprint(doc: BlueprintDoc, byId: Map<string, ParsedDoc>): DriftIssue[] {
  const fm = doc.frontmatter;
  const issues: DriftIssue[] = [];
  // `blueprintSchema` already requires a non-empty `architects`, so a parsed-from-disk document never trips
  // this; it stays as a nominal rule (defense in depth) for ParsedDocs handed in by an engine, not the parser.
  // SDD-125 D3: its own drift kind (`blueprint_without_feature`) so the report -- and the station attribution
  // that puts it in `diseno_tecnico` -- can name the hole instead of a generic violation.
  if (fm.architects.length === 0) {
    issues.push(violation(doc.node.id, 'error', `${doc.node.id} needs a non-empty "architects": a blueprint must say which PRD/FR it designs`, 'blueprint_without_feature'));
  }
  if (fm.impacts_paths.length === 0) {
    issues.push(violation(doc.node.id, 'error', `${doc.node.id} needs a non-empty "impacts_paths": a blueprint must declare the code it governs`));
  }
  if (!hasTasksChecklist(doc.node.body)) {
    issues.push(
      violation(doc.node.id, 'error', `${doc.node.id} needs a "## Tareas"/"## Tasks" checklist with at least one item before work orders can be generated from it`),
    );
  }
  const unapproved = fm.architects.filter((id) => {
    const feature = byId.get(id);
    return feature !== undefined && feature.node.label === 'Feature' && feature.node.status !== 'approved' && feature.node.status !== 'closed';
  });
  if (unapproved.length > 0) {
    issues.push(
      violation(doc.node.id, 'warning', `${doc.node.id} (design_before_approval) architects ${unapproved.join(', ')}, which is not yet "approved"/"closed"`),
    );
  }
  return issues;
}

function checkWorkOrder(doc: WorkOrderDoc): DriftIssue[] {
  if (doc.frontmatter.source_task) return [];
  return [violation(doc.node.id, 'error', `${doc.node.id} has no "source_task": work orders must come from \`prdm wo generate\` against a blueprint checklist`)];
}

function checkDoc(doc: ParsedDoc, docs: readonly ParsedDoc[], byId: Map<string, ParsedDoc>, mode: 'edit' | 'publish'): DriftIssue[] {
  switch (doc.frontmatter.type) {
    case 'FB':
      return checkFeedback(doc as FeedbackDoc, docs);
    case 'ART':
      return checkArtifact(doc as ArtifactDoc);
    case 'MRD':
    case 'PRD':
    case 'FR':
      return checkFeature(doc as FeatureDoc, docs, byId, mode);
    case 'SDD':
    case 'ADR':
      return checkBlueprint(doc as BlueprintDoc, byId);
    case 'WO':
      return checkWorkOrder(doc as WorkOrderDoc);
    case 'BC':
      return checkBusinessCase(doc as BusinessCaseDoc, docs);
  }
}

type GrandfatherStatus = 'exempt' | 'lapsed' | 'none';

function grandfatherStatus(doc: ParsedDoc, ctx: LifecycleContext): GrandfatherStatus {
  const entry = ctx.grandfathered.find((g) => g.id === doc.node.id);
  if (!entry) return 'none';
  return entry.hash === doc.node.contentHash ? 'exempt' : 'lapsed';
}

/**
 * Pure lifecycle invariants of PRD-002 §3 (SDD-002 "Ciclo de vida") over a project's documents.
 * Contract for WO-013 (draft validation), WO-019 (implementation) and refresh; issues use kind `lifecycle_violation`.
 * `ctx.grandfathered` exempts a document while its content hash matches the recorded one (ADR-002 D13); a listed
 * id whose hash has since changed emits a one-time "grandfathering lapsed" warning and then the rules apply.
 */
export function checkLifecycle(docs: readonly ParsedDoc[], ctx: LifecycleContext): DriftIssue[] {
  const byId = new Map(docs.map((d) => [d.node.id, d]));
  const issues: DriftIssue[] = [];
  for (const doc of docs) {
    const status = grandfatherStatus(doc, ctx);
    if (status === 'lapsed') {
      issues.push(violation(doc.node.id, 'warning', `${doc.node.id} grandfathering lapsed (its content changed since it was exempted); lifecycle rules now apply`));
    }
    if (status === 'exempt') continue;
    issues.push(...checkDoc(doc, docs, byId, ctx.mode ?? 'edit'));
  }
  return issues;
}
