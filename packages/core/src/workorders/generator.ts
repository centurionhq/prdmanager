import type { ProjectEngine, RefreshReport } from '../engine.js';
import type { ParsedDoc, WorkOrderStatus } from '../domain/schema.js';
import { checkLifecycle } from '../lifecycle/check.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';
import { normalizeText, sha256 } from '../util/hash.js';
import { nextId, renderDocument, slugify, todayIso } from '../util/ids.js';
import { classifyDeliverable, parseDeliverableDeclaration, type DeliverableKind } from './deliverable.js';

type WorkOrderDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'WO' }> };
type BlueprintDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'SDD' | 'ADR' }> };

const isWorkOrder = (d: ParsedDoc): d is WorkOrderDoc => d.frontmatter.type === 'WO';
const isBlueprint = (d: ParsedDoc): d is BlueprintDoc => d.frontmatter.type === 'SDD' || d.frontmatter.type === 'ADR';

const TASKS_HEADING = /^##\s+(Tareas|Tasks)\s*$/im;
const ANY_HEADING = /^##\s+.+$/m;
const CHECKLIST_LINE = /^[-*]\s*\[([ xX])\]\s*(.+)$/;

export interface ChecklistItem {
  text: string;
  done: boolean;
}

/** Extracts every `- [ ]`/`- [x]` line anywhere in a document body, in order. */
export function extractChecklistItems(body: string): ChecklistItem[] {
  return body
    .split('\n')
    .map((line) => CHECKLIST_LINE.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ done: (m[1] ?? '').toLowerCase() === 'x', text: (m[2] ?? '').trim() }));
}

const PATHS_OVERRIDE_LINE = /^paths:\s*(.+)$/i;
/** Any `deliverable:` line, valid or not: invalid values are ignored but still belong to the override block. */
const DELIVERABLE_LINE_SHAPE = /^deliverable:/i;

interface TaskItem extends ChecklistItem {
  /** Explicit `paths: a.ts, b.ts` line right under the item (SDD-068 D3); wins over the textual match. */
  paths?: string[];
  /** Explicit `deliverable: gate|code` line under the item (SDD-093 D3); wins over the text heuristic. */
  deliverable?: DeliverableKind;
}

/** Like `extractTasks`, but also reads the consecutive `paths:`/`deliverable:` override lines directly below an item (not counted as items). */
function extractTasksWithPaths(body: string): TaskItem[] {
  const heading = TASKS_HEADING.exec(body);
  if (!heading) return [];
  const rest = body.slice(heading.index + heading[0].length);
  const next = ANY_HEADING.exec(rest);
  const lines = (next ? rest.slice(0, next.index) : rest).split('\n').map((l) => l.trim());

  const items: TaskItem[] = [];
  lines.forEach((line, i) => {
    const m = CHECKLIST_LINE.exec(line);
    if (!m) return;
    let paths: string[] = [];
    let deliverable: DeliverableKind | undefined;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? '';
      const pathsMatch = PATHS_OVERRIDE_LINE.exec(next);
      const declared = parseDeliverableDeclaration(next);
      if (pathsMatch) {
        if (paths.length === 0) paths = (pathsMatch[1] ?? '').split(',').map((p) => p.trim()).filter((p) => p.length > 0);
      } else if (declared) {
        deliverable ??= declared;
      } else if (!DELIVERABLE_LINE_SHAPE.test(next)) {
        break;
      }
    }
    items.push({
      done: (m[1] ?? '').toLowerCase() === 'x',
      text: (m[2] ?? '').trim(),
      ...(paths.length > 0 ? { paths } : {}),
      ...(deliverable ? { deliverable } : {}),
    });
  });
  return items;
}

function extractTasks(body: string): ChecklistItem[] {
  return extractTasksWithPaths(body).map(({ text, done }) => ({ text, done }));
}

export type ImpactPathsSource = 'override' | 'match' | 'inherited';

const normalizePath = (p: string): string => p.trim().replace(/^\.\//, '');
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

/** True when `needle` appears in `haystack` (both lowercased) with no word character on either side. */
function containsToken(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) return true;
  }
  return false;
}

function pathMatchesText(path: string, text: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (/[*?]/.test(base)) return text.includes(path);
  if (text.includes(path)) return true;
  if (containsToken(text, base)) return true;
  const dot = base.lastIndexOf('.');
  return dot > 0 && containsToken(text, base.slice(0, dot));
}

/**
 * Derives the `impacts_paths` of one task (SDD-068 D1-D3): explicit override > blueprint paths named by the
 * item text > the whole blueprint list (declared as inherited in the WO body).
 */
export function deriveImpactPaths(
  taskText: string,
  override: string[] | undefined,
  blueprintPaths: string[],
): { paths: string[]; source: ImpactPathsSource } {
  if (override && override.length > 0) return { paths: override, source: 'override' };
  const text = taskText.toLowerCase();
  const matched = [...new Set(blueprintPaths.map(normalizePath))].filter((p) => pathMatchesText(p.toLowerCase(), text));
  return matched.length > 0 ? { paths: matched, source: 'match' } : { paths: blueprintPaths, source: 'inherited' };
}

export interface PlanOptions {
  docsDir: string;
  now: Date;
  /** Ids to treat as taken beyond `existing`, e.g. ids found in documents that failed validation (see ScanResult.ids). */
  reservedIds?: string[];
  /** Destination folder for new work orders (WO-017 folder map); defaults to `${docsDir}/work-orders` for callers that don't pass `config.folders.WO`. */
  folder?: string;
}

export interface PlannedWorkOrder {
  id: string;
  path: string;
  title: string;
  status: WorkOrderStatus;
  content: string;
}

function sourceTaskOf(blueprintId: string, text: string): string {
  return sha256(`${blueprintId}\n${normalizeText(text)}`).slice(0, 16);
}

const INHERITED_PATHS_DECLARATION = 'heredados del blueprint (el ítem no nombra archivos)';

const GATE_CRITERIA = [
  '- [ ] Evidencia registrada (comando + salida + ART o tarjeta del gate)',
  '- [ ] Cerrada con `archive_work_order` + motivo que nombra la evidencia',
];

const codeCriteria = (blueprintId: string, id: string): string[] => [
  `- [ ] Implementación realizada dentro del código gobernado por ${blueprintId}`,
  '- [ ] Tests que cubren el cambio',
  `- [ ] Commit realizado con el trailer \`Refs: ${id}\``,
];

function buildBody(blueprint: BlueprintDoc, taskText: string, id: string, derived: { paths: string[]; source: ImpactPathsSource }, kind: DeliverableKind | undefined): string {
  const pathsDeclaration = derived.source === 'inherited' ? INHERITED_PATHS_DECLARATION : derived.paths.join(', ');
  const features = blueprint.frontmatter.architects.join(', ');
  return [
    '## Objetivo',
    taskText,
    '',
    '## Contexto',
    `${blueprint.node.id} — ${blueprint.node.title}; features: ${features}`,
    '',
    `paths: ${pathsDeclaration}`,
    '',
    '## Criterios de aceptación',
    ...(kind === 'gate' ? GATE_CRITERIA : codeCriteria(blueprint.node.id, id)),
  ].join('\n');
}

/** Every generated work order is born `pending` (ADR-002 D9/PRD-002 lifecycle): checking off a task never fabricates history. */
function buildFields(blueprint: BlueprintDoc, id: string, title: string, sourceTask: string, now: Date, impactsPaths: string[], kind: DeliverableKind | undefined): Record<string, FieldValue> {
  return {
    id,
    type: 'WO',
    title,
    status: 'pending',
    created_at: todayIso(now),
    implements: [blueprint.node.id],
    impacts_paths: impactsPaths,
    source_task: sourceTask,
    ...(kind ? { deliverable_kind: kind } : {}),
    tags: blueprint.node.tags,
  };
}

const MAX_TITLE = 300;

/** Pure planning: turns the `## Tareas`/`## Tasks` checklist of a blueprint into work orders, skipping tasks already generated (by source_task). */
export function planWorkOrders(blueprint: ParsedDoc, existing: ParsedDoc[], options: PlanOptions): PlannedWorkOrder[] {
  if (!isBlueprint(blueprint)) throw new Error(`${blueprint.node.id} is not a blueprint`);
  const tasks = extractTasksWithPaths(blueprint.node.body);
  if (tasks.length === 0) return [];

  const knownSourceTasks = new Set(existing.filter(isWorkOrder).map((d) => d.frontmatter.source_task).filter((v): v is string => v !== undefined));
  const existingIds = [...existing.map((d) => d.node.id), ...(options.reservedIds ?? [])];
  const planned: PlannedWorkOrder[] = [];

  for (const task of tasks) {
    const sourceTask = sourceTaskOf(blueprint.node.id, task.text);
    if (knownSourceTasks.has(sourceTask)) continue;
    knownSourceTasks.add(sourceTask);

    const id = nextId('WO', [...existingIds, ...planned.map((p) => p.id)]);
    const title = task.text.slice(0, MAX_TITLE);
    const folder = options.folder ?? `${options.docsDir}/work-orders`;
    const path = `${folder}/${id}-${slugify(task.text)}.md`;
    const derived = deriveImpactPaths(task.text, task.paths, blueprint.impactsPaths);
    // SDD-093 D3: declared wins; else the heuristic only ever persists `gate` (absent already means `code`).
    const kind = task.deliverable ?? (classifyDeliverable(task.text) === 'gate' ? 'gate' : undefined);
    const fields = buildFields(blueprint, id, title, sourceTask, options.now, derived.paths, kind);
    const content = renderDocument(fields, buildBody(blueprint, task.text, id, derived, kind));

    planned.push({ id, path, title, status: 'pending', content });
  }
  return planned;
}

export interface GenerateResult {
  created: { id: string; path: string; title: string; status: WorkOrderStatus }[];
  skipped: number;
  report: RefreshReport;
}

/** Generates work orders from a blueprint's task checklist; idempotent across runs. */
export async function generateWorkOrders(engine: ProjectEngine, blueprintId: string): Promise<GenerateResult> {
  return engine.transaction(
    async (ops) => {
      const scan = await ops.scan();
      const blueprint = scan.docs.find((d) => d.node.id === blueprintId);
      if (!blueprint) throw new Error(`blueprint ${blueprintId} not found`);
      if (!isBlueprint(blueprint)) throw new Error(`${blueprintId} is not a blueprint`);

      // WO-023 finding 7: a blueprint that fails its own lifecycle design rule (non-empty impacts_paths and a
      // "## Tareas"/"## Tasks" checklist) must never generate work orders from it.
      const lifecycleIssues = checkLifecycle(scan.docs, { grandfathered: ops.config.lifecycle.grandfathered });
      const blueprintErrors = lifecycleIssues.filter((issue) => issue.nodeId === blueprintId && issue.severity === 'error');
      if (blueprintErrors.length > 0) {
        throw new Error(`${blueprintId} fails its lifecycle design rule and cannot generate work orders: ${blueprintErrors.map((i) => i.message).join('; ')}`);
      }

      const totalTasks = extractTasks(blueprint.node.body).length;
      const planned = planWorkOrders(blueprint, scan.docs, {
        docsDir: ops.config.docsDir,
        now: new Date(),
        reservedIds: scan.ids,
        folder: ops.config.folders.WO,
      });
      for (const wo of planned) await ops.createDocument(wo.path, wo.content);
      const report = await ops.refresh();

      return {
        created: planned.map(({ id, path, title, status }) => ({ id, path, title, status })),
        skipped: totalTasks - planned.length,
        report,
      };
    },
    { atomic: true },
  );
}

const MAX_TASK_TEXT = 500;

export interface AddBlueprintTaskResult {
  blueprint_id: string;
  task: string;
}

/**
 * Appends one `- [ ] <text>` line to a blueprint's `## Tareas`/`## Tasks` checklist (creating the
 * section, at the end of the body, if the blueprint doesn't have one yet) via `ops.replaceDocument` —
 * the same engine-write primitive `generateWorkOrders` above uses to create new WO documents, safe for
 * exactly the non-`collab`-origin documents this repo's blueprints are (SDD-007's `PgProjectEngine`
 * refuses `replaceDocument` on a document with a live collaborative working copy). Added alongside the
 * remote MCP's own `generate_work_orders` (SDD-010 revisited) so a developer's code assistant can turn
 * a new requirement into a claimable Work Order end-to-end without the dashboard's collaborative
 * editor, which blueprints never use anyway.
 */
export async function addBlueprintTask(engine: ProjectEngine, blueprintId: string, taskText: string): Promise<AddBlueprintTaskResult> {
  const text = taskText.trim();
  if (text.length === 0) throw new Error('task text must not be empty');
  if (text.length > MAX_TASK_TEXT) throw new Error(`task text must be at most ${MAX_TASK_TEXT} characters`);

  return engine.transaction(
    async (ops) => {
      const scan = await ops.scan();
      const blueprint = scan.docs.find((d) => d.node.id === blueprintId);
      if (!blueprint) throw new Error(`blueprint ${blueprintId} not found`);
      if (!isBlueprint(blueprint)) throw new Error(`${blueprintId} is not a blueprint`);

      const body = blueprint.node.body;
      const line = `- [ ] ${text}`;
      const heading = TASKS_HEADING.exec(body);
      const nextBody = heading
        ? insertIntoTasksSection(body, heading, line)
        : `${body.trimEnd()}\n\n## Tareas\n\n${line}\n`;

      const content = renderDocument(blueprint.frontmatter as unknown as Record<string, FieldValue>, nextBody);
      await ops.replaceDocument(blueprintId, content);

      return { blueprint_id: blueprintId, task: text };
    },
    { atomic: true },
  );
}

/** Inserts `line` as the last checklist item of the `## Tareas`/`## Tasks` section located by `heading`
 * (right before the next `##` heading, or at the end of the body if the tasks section is the last one). */
function insertIntoTasksSection(body: string, heading: RegExpExecArray, line: string): string {
  const sectionStart = heading.index + heading[0].length;
  const rest = body.slice(sectionStart);
  const next = ANY_HEADING.exec(rest);
  const insertAt = next ? sectionStart + next.index : body.length;
  return `${body.slice(0, insertAt).trimEnd()}\n${line}\n\n${body.slice(insertAt).trimStart()}`.trimEnd() + '\n';
}
