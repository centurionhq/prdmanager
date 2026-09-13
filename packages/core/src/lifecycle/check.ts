import type { ParsedDoc } from '../domain/schema.js';
import type { GrandfatheredDoc } from '../project/types.js';
import type { DriftIssue } from '../sync/monitor.js';

export interface LifecycleContext {
  /** Pre-PRD-002 documents exempt while their content hash is unchanged (ADR-002 D13). */
  grandfathered: readonly GrandfatheredDoc[];
}

type FeatureDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'MRD' | 'PRD' | 'FR' }> };
type BlueprintDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'SDD' | 'ADR' }> };
type WorkOrderDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'WO' }> };
type ArtifactDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'ART' }> };
type FeedbackDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'FB' }> };

const TASKS_HEADING = /^##\s+(Tareas|Tasks)\s*$/im;
const NEXT_HEADING = /^##\s+.+$/m;
const CHECKLIST_LINE = /^[-*]\s*\[[ xX]\]/;

/** True when `body` has a `## Tareas`/`## Tasks` heading whose section contains at least one `- [ ]`/`- [x]` line. */
function hasTasksChecklist(body: string): boolean {
  const heading = TASKS_HEADING.exec(body);
  if (!heading) return false;
  const rest = body.slice(heading.index + heading[0].length);
  const next = NEXT_HEADING.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  return section.split('\n').some((line) => CHECKLIST_LINE.test(line.trim()));
}

function violation(nodeId: string, severity: DriftIssue['severity'], message: string): DriftIssue {
  return { kind: 'lifecycle_violation', severity, nodeId, message };
}

function checkFeedback(doc: FeedbackDoc): DriftIssue[] {
  const fm = doc.frontmatter;
  if (fm.informs.length > 0 || fm.root) return [];
  return fm.status === 'new'
    ? [violation(doc.node.id, 'warning', `${doc.node.id} is still untriaged: link it via "informs" (or mark "root: true") before it can justify a feature`)]
    : [violation(doc.node.id, 'error', `${doc.node.id} must link to a feature via "informs" (or be marked "root: true")`)];
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
function hasJustification(doc: FeatureDoc, docs: readonly ParsedDoc[]): boolean {
  if ((doc.frontmatter.justified_by ?? []).length > 0) return true;
  return docs.some((d) => {
    if (d.frontmatter.type === 'FB') return d.frontmatter.informs.includes(doc.node.id);
    if (d.frontmatter.type === 'ART') return d.frontmatter.provides_context_for.includes(doc.node.id);
    return false;
  });
}

function checkFeature(doc: FeatureDoc, docs: readonly ParsedDoc[]): DriftIssue[] {
  if (hasJustification(doc, docs)) return [];
  return [
    violation(
      doc.node.id,
      'error',
      `${doc.node.id} has no justification: link an existing Feedback or Artifact via "justified_by" (or have one point back to it via "informs"/"provides_context_for")`,
    ),
  ];
}

function checkBlueprint(doc: BlueprintDoc, byId: Map<string, ParsedDoc>): DriftIssue[] {
  const fm = doc.frontmatter;
  const issues: DriftIssue[] = [];
  if (fm.impacts_paths.length === 0 || !hasTasksChecklist(doc.node.body)) {
    issues.push(violation(doc.node.id, 'error', `${doc.node.id} needs both "impacts_paths" and a "## Tareas"/"## Tasks" checklist before work orders can be generated from it`));
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

function checkDoc(doc: ParsedDoc, docs: readonly ParsedDoc[], byId: Map<string, ParsedDoc>): DriftIssue[] {
  switch (doc.frontmatter.type) {
    case 'FB':
      return checkFeedback(doc as FeedbackDoc);
    case 'ART':
      return checkArtifact(doc as ArtifactDoc);
    case 'MRD':
    case 'PRD':
    case 'FR':
      return checkFeature(doc as FeatureDoc, docs);
    case 'SDD':
    case 'ADR':
      return checkBlueprint(doc as BlueprintDoc, byId);
    case 'WO':
      return checkWorkOrder(doc as WorkOrderDoc);
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
    issues.push(...checkDoc(doc, docs, byId));
  }
  return issues;
}
