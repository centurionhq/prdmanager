import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import {
  ACTOR_PATTERN,
  claimWorkOrder,
  completeWorkOrder,
  generateWorkOrders,
  getWorkOrderContext,
  WORK_ORDER_STATUSES,
  type WorkOrderContext,
  type WorkOrderStatus,
  type WorkOrderSummary,
} from '@prdm/core';
import { formatIssues } from '../format.js';
import { CliError } from '../errors.js';
import { withContext, type CliDeps } from '../program.js';
import { assertLocalMutationAllowed } from '../remote/guard.js';

const execFileAsync = promisify(execFile);

function parseStatus(value: string): WorkOrderStatus {
  if (!(WORK_ORDER_STATUSES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`status must be one of ${WORK_ORDER_STATUSES.join(', ')}`);
  }
  return value as WorkOrderStatus;
}

function parseActor(value: string): string {
  if (!ACTOR_PATTERN.test(value)) throw new InvalidArgumentError('actor must look like agent:name or dev:name');
  return value;
}

function resolveActor(as: string | undefined): string {
  const actor = as ?? process.env.PRDM_ACTOR;
  if (!actor) throw new CliError('an actor is required: pass --as or set PRDM_ACTOR');
  if (!ACTOR_PATTERN.test(actor)) throw new CliError(`invalid PRDM_ACTOR: ${actor} (expected agent:name or dev:name)`);
  return actor;
}

async function resolveHead(root: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
  return stdout.trim();
}

async function runGenerate(deps: CliDeps, blueprintId: string): Promise<void> {
  assertLocalMutationAllowed(deps.root, 'wo generate');
  await withContext(deps, async (ctx) => {
    const result = await generateWorkOrders(ctx.engine, blueprintId);
    if (result.created.length === 0) deps.stdout('created: (none)');
    else {
      deps.stdout('created:');
      for (const wo of result.created) deps.stdout(`  ${wo.id}  ${wo.status}  ${wo.path}  ${wo.title}`);
    }
    deps.stdout(`skipped: ${result.skipped}`);
  });
}

/**
 * The document path that exists on disk (SDD-074 D3): the `.prdm/remote` mirror when `prdm sync` left it in the
 * checkout, else the canonical published path (which may not exist locally — D4, the server never guesses).
 * The other path is declared with its mark.
 */
export function formatWorkOrderDocPaths(root: string, wo: Pick<WorkOrderSummary, 'sourcePath' | 'mirrorPath'>): string {
  if (existsSync(join(root, wo.mirrorPath))) return `${wo.mirrorPath}  ${wo.sourcePath} (canonica)`;
  return `${wo.sourcePath}  ${wo.mirrorPath} (sin copia local)`;
}

export function formatWorkOrderLine(wo: WorkOrderSummary, root: string): string {
  const landed = wo.landedCommitSha ? `  ⚠ landed ${wo.landedCommitSha.slice(0, 7)}` : '';
  return `${wo.id}  ${wo.status}  ${wo.assignedTo ?? '-'}  ${wo.blueprints.join(',') || '-'}  ${formatWorkOrderDocPaths(root, wo)}${landed}  ${wo.title}`;
}

async function runList(deps: CliDeps, options: { status?: WorkOrderStatus; blueprint?: string; json?: boolean }): Promise<void> {
  await withContext(deps, async (ctx) => {
    const list = await ctx.store.listWorkOrders({ status: options.status, blueprint: options.blueprint });
    if (options.json) deps.stdout(JSON.stringify(list, null, 2));
    else for (const wo of list) deps.stdout(formatWorkOrderLine(wo, deps.root));
  });
}

export function formatWorkOrderContext(context: WorkOrderContext, root: string): string {
  const { workOrder } = context;
  return [
    `${workOrder.id}: ${workOrder.title} (${workOrder.status})`,
    `document: ${formatWorkOrderDocPaths(root, workOrder)}`,
    `assigned to: ${workOrder.assignedTo ?? '-'}`,
    `blueprints: ${context.blueprints.map((b) => `${b.id} (${b.status})`).join(', ') || '(none)'}`,
    `lineage: ${context.featureLineage.map((f) => `${f.id} <${f.kind}>`).join(', ') || '(none)'}`,
    'governed code:',
    ...context.code.map((c) => `  ${c.status === 'out_of_sync' ? '⚠' : '✓'} ${c.path}${c.symbol ? `#${c.symbol}` : ''} (${c.blueprint})`),
    `commits: ${context.commits.map((c) => c.sha.slice(0, 7)).join(', ') || '(none)'}`,
    'acceptance criteria:',
    ...workOrder.acceptanceCriteria.map((item) => `  - ${item}`),
    '',
    context.instructions,
  ].join('\n');
}

async function runContext(deps: CliDeps, id: string, options: { json?: boolean }): Promise<void> {
  await withContext(deps, async (ctx) => {
    const context = await getWorkOrderContext(ctx.store, id);
    if (!context) throw new CliError(`unknown work order: ${id}`);
    deps.stdout(options.json ? JSON.stringify(context, null, 2) : formatWorkOrderContext(context, deps.root));
  });
}

async function runClaim(deps: CliDeps, id: string, options: { as?: string }): Promise<void> {
  assertLocalMutationAllowed(deps.root, 'wo claim');
  await withContext(deps, async (ctx) => {
    const actor = resolveActor(options.as);
    const result = await claimWorkOrder(ctx.engine, id, actor);
    deps.stdout(`${result.id}: ${result.status} (${result.assignedTo})`);
  });
}

async function runComplete(deps: CliDeps, id: string, options: { commit?: string }): Promise<void> {
  assertLocalMutationAllowed(deps.root, 'wo complete');
  await withContext(deps, async (ctx) => {
    const commitSha = options.commit === 'HEAD' ? await resolveHead(deps.root) : options.commit;
    const result = await completeWorkOrder(ctx.engine, id, { commitSha });
    deps.stdout(`${result.id}: ${result.status}`);
    deps.stdout(result.drift.length > 0 ? formatIssues(result.drift) : 'drift: none');
  });
}

export function register(program: Command, deps: CliDeps): void {
  const wo = program.command('wo').description('manage work orders');

  wo.command('generate')
    .description('generate work orders from a blueprint task checklist')
    .argument('<blueprintId>', 'blueprint id (SDD/ADR)')
    .action((blueprintId: string) => runGenerate(deps, blueprintId));

  wo.command('list')
    .description('list work orders')
    .option('--status <status>', `filter by status: ${WORK_ORDER_STATUSES.join(', ')}`, parseStatus)
    .option('--blueprint <id>', 'filter by blueprint id')
    .option('--json', 'print as JSON')
    .action((options: { status?: WorkOrderStatus; blueprint?: string; json?: boolean }) => runList(deps, options));

  wo.command('context')
    .description('print the agent-ready context bundle for a work order')
    .argument('<id>', 'work order id')
    .option('--json', 'print the full context as JSON')
    .action((id: string, options: { json?: boolean }) => runContext(deps, id, options));

  wo.command('claim')
    .description('claim a pending/out_of_sync work order')
    .argument('<id>', 'work order id')
    .option('--as <actor>', 'actor claiming it (agent:name or dev:name); defaults to $PRDM_ACTOR', parseActor)
    .action((id: string, options: { as?: string }) => runClaim(deps, id, options));

  wo.command('complete')
    .description('complete an in_progress/out_of_sync work order')
    .argument('<id>', 'work order id')
    .option('--commit <sha>', 'commit sha to record ("HEAD" resolves the current commit)')
    .action((id: string, options: { commit?: string }) => runComplete(deps, id, options));
}
