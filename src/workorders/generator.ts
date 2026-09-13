import type { Engine, RefreshReport } from '../engine.js';
import type { ParsedDoc, WorkOrderStatus } from '../domain/schema.js';
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

function buildFields(blueprint: BlueprintDoc, id: string, title: string, status: WorkOrderStatus, sourceTask: string, now: Date): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {
    id,
    type: 'WO',
    title,
    status,
    created_at: todayIso(now),
    implements: [blueprint.node.id],
    governs: blueprint.governs,
    source_task: sourceTask,
    tags: blueprint.node.tags,
  };
  if (status === 'done') fields.blueprint_hashes = { [blueprint.node.id]: blueprint.node.contentHash };
  return fields;
}

const MAX_TITLE = 300;

/** Pure planning: turns the `## Tareas`/`## Tasks` checklist of a blueprint into work orders, skipping tasks already generated (by source_task). */
export function planWorkOrders(blueprint: ParsedDoc, existing: ParsedDoc[], options: PlanOptions): PlannedWorkOrder[] {
  if (!isBlueprint(blueprint)) throw new Error(`${blueprint.node.id} is not a blueprint`);
  const tasks = extractTasks(blueprint.node.body);
  if (tasks.length === 0) return [];

  const knownSourceTasks = new Set(existing.filter(isWorkOrder).map((d) => d.frontmatter.source_task).filter((v): v is string => v !== undefined));
  const existingIds = existing.map((d) => d.node.id);
  const planned: PlannedWorkOrder[] = [];

  for (const task of tasks) {
    const sourceTask = sourceTaskOf(blueprint.node.id, task.text);
    if (knownSourceTasks.has(sourceTask)) continue;
    knownSourceTasks.add(sourceTask);

    const id = nextId('WO', [...existingIds, ...planned.map((p) => p.id)]);
    const status: WorkOrderStatus = task.done ? 'done' : 'todo';
    const title = task.text.slice(0, MAX_TITLE);
    const path = `${options.docsDir}/work-orders/${id}-${slugify(task.text)}.md`;
    const fields = buildFields(blueprint, id, title, status, sourceTask, options.now);
    const content = renderDocument(fields, buildBody(blueprint, task.text, id));

    planned.push({ id, path, title, status, content });
  }
  return planned;
}

export interface GenerateResult {
  created: { id: string; path: string; title: string; status: WorkOrderStatus }[];
  skipped: number;
  report: RefreshReport;
}

/** Generates work orders from a blueprint's task checklist; idempotent across runs. */
export async function generateWorkOrders(engine: Engine, blueprintId: string): Promise<GenerateResult> {
  return engine.transaction(async (ops) => {
    const { docs } = await ops.scan();
    const blueprint = docs.find((d) => d.node.id === blueprintId);
    if (!blueprint) throw new Error(`blueprint ${blueprintId} not found`);
    if (!isBlueprint(blueprint)) throw new Error(`${blueprintId} is not a blueprint`);

    const totalTasks = extractTasks(blueprint.node.body).length;
    const planned = planWorkOrders(blueprint, docs, { docsDir: ops.config.docsDir, now: new Date() });
    for (const wo of planned) await ops.createDocument(wo.path, wo.content);
    const report = await ops.refresh();

    return {
      created: planned.map(({ id, path, title, status }) => ({ id, path, title, status })),
      skipped: totalTasks - planned.length,
      report,
    };
  });
}
