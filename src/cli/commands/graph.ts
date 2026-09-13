import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import { NODE_LABELS, type NodeLabel } from '../../domain/schema.js';
import { buildForest, renderMermaid, renderText, type TreeNode } from '../../graph/tree.js';
import type { Subgraph } from '../../graph/types.js';
import { formatSearchHits } from '../format.js';
import { CliError } from '../errors.js';
import { withContext, type CliContext, type CliDeps } from '../program.js';

const TREE_FORMATS = ['text', 'json', 'mermaid'] as const;
type TreeFormat = (typeof TREE_FORMATS)[number];

function parseTreeFormat(value: string): TreeFormat {
  if (!(TREE_FORMATS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`format must be one of ${TREE_FORMATS.join(', ')}`);
  }
  return value as TreeFormat;
}

function parseLimit(value: string): number {
  const limit = Number.parseInt(value, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InvalidArgumentError('limit must be an integer between 1 and 100');
  }
  return limit;
}

function parseLabel(value: string): NodeLabel {
  if (!(NODE_LABELS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`label must be one of ${NODE_LABELS.join(', ')}`);
  }
  return value as NodeLabel;
}

function renderTree(forest: TreeNode[], format: TreeFormat): string {
  if (format === 'json') return JSON.stringify(forest, null, 2);
  if (format === 'mermaid') return renderMermaid(forest);
  return renderText(forest);
}

async function loadTreeGraph(ctx: CliContext, id: string | undefined): Promise<Subgraph> {
  if (!id) return ctx.store.fullGraph();
  if (!(await ctx.store.getNode(id))) throw new CliError(`unknown node: ${id}`);
  return ctx.store.branch(id);
}

async function runTree(deps: CliDeps, id: string | undefined, options: { format: TreeFormat }): Promise<void> {
  await withContext(deps, async (ctx) => {
    const graph = await loadTreeGraph(ctx, id);
    deps.stdout(renderTree(buildForest(graph), options.format));
  });
}

async function runNode(deps: CliDeps, id: string): Promise<void> {
  await withContext(deps, async (ctx) => {
    const detail = await ctx.store.getNode(id);
    if (!detail) throw new CliError(`unknown node: ${id}`);
    deps.stdout(JSON.stringify(detail, null, 2));
  });
}

async function runSearch(deps: CliDeps, query: string, options: { label?: NodeLabel; limit: number }): Promise<void> {
  const labels = options.label ? [options.label] : undefined;
  await withContext(deps, async (ctx) => {
    const hits = await ctx.store.search(query, { labels, limit: options.limit });
    deps.stdout(formatSearchHits(hits));
  });
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('tree')
    .description('render the feature tree, optionally rooted at a node')
    .argument('[id]', 'node id to root the tree at')
    .option('--format <format>', 'output format: text, json, mermaid', parseTreeFormat, 'text')
    .action((id: string | undefined, options: { format: TreeFormat }) => runTree(deps, id, options));

  program
    .command('node')
    .description('print a node and its links as JSON')
    .argument('<id>', 'node id')
    .action((id: string) => runNode(deps, id));

  program
    .command('search')
    .description('full-text search across documents')
    .argument('<query>', 'search text')
    .option('--label <label>', `restrict to a label: ${NODE_LABELS.join(', ')}`, parseLabel)
    .option('--limit <n>', 'maximum number of results (1-100)', parseLimit, 10)
    .action((query: string, options: { label?: NodeLabel; limit: number }) => runSearch(deps, query, options));
}
