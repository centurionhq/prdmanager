import type { ProjectEngine, RefreshReport } from '../engine.js';
import type { ParsedDoc, WorkOrderStatus } from '../domain/schema.js';
import { checkLifecycle } from '../lifecycle/check.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';
import { normalizeText, sha256 } from '../util/hash.js';
import { nextId, renderDocument, slugify, todayIso } from '../util/ids.js';

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

function extractTasks(body: string): ChecklistItem[] {
  const heading = TASKS_HEADING.exec(body);
  if (!heading) return [];
  const rest = body.slice(heading.index + heading[0].length);
  const next = ANY_HEADING.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  return extractChecklistItems(section);
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

function buildBody(blueprint: BlueprintDoc, taskText: string, id: string): string {
  const features = blueprint.frontmatter.architects.join(', ');
  return [
    '## Objetivo',
    taskText,
    '',
    '## Contexto',
    `${blueprint.node.id} — ${blueprint.node.title}; features: ${features}`,
    '',
    '## Criterios de aceptación',
    `- [ ] Implementación realizada dentro del código gobernado por ${blueprint.node.id}`,
    '- [ ] Tests que cubren el cambio',
    `- [ ] Commit realizado con el trailer \`Refs: ${id}\``,
  ].join('\n');
}

/** Every generated work order is born `pending` (ADR-002 D9/PRD-002 lifecycle): checking off a task never fabricates history. */
function buildFields(blueprint: BlueprintDoc, id: string, title: string, sourceTask: string, now: Date): Record<string, FieldValue> {
  return {
    id,
    type: 'WO',
    title,
    status: 'pending',
    created_at: todayIso(now),
    implements: [blueprint.node.id],
    impacts_paths: blueprint.impactsPaths,
    source_task: sourceTask,
    tags: blueprint.node.tags,
  };
}

const MAX_TITLE = 300;

/** Pure planning: turns the `## Tareas`/`## Tasks` checklist of a blueprint into work orders, skipping tasks already generated (by source_task). */
export function planWorkOrders(blueprint: ParsedDoc, existing: ParsedDoc[], options: PlanOptions): PlannedWorkOrder[] {
  if (!isBlueprint(blueprint)) throw new Error(`${blueprint.node.id} is not a blueprint`);
  const tasks = extractTasks(blueprint.node.body);
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
    const fields = buildFields(blueprint, id, title, sourceTask, options.now);
    const content = renderDocument(fields, buildBody(blueprint, task.text, id));

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
