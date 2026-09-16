/**
 * Pure helpers for the "revisar antes de publicar" screen (SDD-013 §"Documentos", WO-357,
 * `DocumentoRevision.dc.html`): summarizing a real `getDocumentVersionDiff` result into the
 * frontmatter/`## Tareas` sections the review shows, plus a generic key-level frontmatter diff for the
 * "links agregados" list. Never touches the network — `PublishReviewModal` owns fetching.
 */
import type { LineDiffOp } from '@prdm/collab';

export interface PublishDiffSummary {
  readonly frontmatter: readonly LineDiffOp[];
  readonly tasks: readonly LineDiffOp[];
  readonly impactsPathsChanged: boolean;
  readonly newTaskCount: number;
}

const RULE_LINE = '---';
const HEADING_PATTERN = /^##\s+/;
const TASKS_HEADING = '## tareas';
const TASK_LINE_PATTERN = /^-\s*\[[ xX]\]/;

type Section = 'pre' | 'frontmatter' | 'body';

/** Splits a full-document line diff into its frontmatter and `## Tareas` slices (changed lines only —
 * `equal` lines carry nothing new to review) by walking the ops in order and tracking which markdown
 * section each one falls in, the same way a person reading the rendered diff top to bottom would. */
export function summarizePublishDiff(ops: readonly LineDiffOp[]): PublishDiffSummary {
  let section: Section = 'pre';
  let inTasks = false;
  const frontmatter: LineDiffOp[] = [];
  const tasks: LineDiffOp[] = [];

  for (const currentOp of ops) {
    const trimmed = currentOp.line.trim();

    if (trimmed === RULE_LINE && section !== 'body') {
      section = section === 'pre' ? 'frontmatter' : 'body';
      continue;
    }
    if (section === 'frontmatter') {
      if (currentOp.type !== 'equal') frontmatter.push(currentOp);
      continue;
    }
    if (HEADING_PATTERN.test(trimmed)) {
      inTasks = trimmed.toLowerCase() === TASKS_HEADING;
      continue;
    }
    if (inTasks && currentOp.type !== 'equal') tasks.push(currentOp);
  }

  return {
    frontmatter,
    tasks,
    impactsPathsChanged: frontmatter.some((op) => op.line.includes('impacts_paths')),
    newTaskCount: tasks.filter((op) => op.type === 'added' && TASK_LINE_PATTERN.test(op.line.trim())).length,
  };
}

/** Checklist items under `## Tareas` in a single version's rendered markdown — used when there is no
 * previously published version to diff against (a document's first-ever publish). */
export function extractTaskLines(markdown: string): string[] {
  let inTasks = false;
  const tasks: string[] = [];

  for (const rawLine of markdown.split('\n')) {
    const trimmed = rawLine.trim();
    if (HEADING_PATTERN.test(trimmed)) {
      inTasks = trimmed.toLowerCase() === TASKS_HEADING;
      continue;
    }
    if (inTasks && TASK_LINE_PATTERN.test(trimmed)) tasks.push(trimmed);
  }

  return tasks;
}

export interface FrontmatterKeyChange {
  readonly key: string;
  readonly before: string | null;
  readonly after: string | null;
}

function formatFrontmatterValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** Generic key-level frontmatter diff (SDD-006 §Modelo de datos: frontmatter is an open `Record<string,
 * unknown>`, never a fixed set of relation kinds `packages/contracts` knows about) — every key whose
 * value actually changed, for the review screen's "links agregados" list. */
export function diffFrontmatterKeys(before: Record<string, unknown>, after: Record<string, unknown>): FrontmatterKeyChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: FrontmatterKeyChange[] = [];

  for (const key of keys) {
    const beforeValue = before[key];
    const afterValue = after[key];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    changes.push({
      key,
      before: beforeValue === undefined ? null : formatFrontmatterValue(beforeValue),
      after: afterValue === undefined ? null : formatFrontmatterValue(afterValue),
    });
  }

  return changes;
}
