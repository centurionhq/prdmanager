/**
 * `get_project_status` (SDD-037/PRD-016, WO-476): the **engineering line** at a glance — how the work is
 * going, not what the product does. Its counterpart is `./get-product-tree.ts`, and keeping the two
 * apart is the entire point: "how is the project going?" and "what does the product do?" are questions
 * over different parts of the graph, and with neither tool available the agent had to guess which one a
 * user meant and then ask for an id it was never going to be given.
 *
 * Takes no arguments on purpose. Every other tool except `search_project` requires an id the user never
 * types, which is exactly why none of them could answer an opening question.
 *
 * Returns an aggregate rather than the graph: `fullGraph()` on a real project is hundreds of nodes and
 * the dispatcher truncates every tool output to ~20 KB (`TOOL_OUTPUT_MAX_BYTES`), so returning it raw
 * would hand the model an arbitrarily cut-off view — worse than no view, because nothing marks where it
 * was cut. Detail stays with `get_node` and `get_feature_branch`.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { resolvePgProjectEngine } from '../../engine/resolve-pg-project-engine.js';
import { AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const inputSchema = z.object({});

/** How many of the most recent blueprints to name. Enough to see what the line is working on now,
 * few enough to stay an aggregate. */
const RECENT_BLUEPRINT_LIMIT = 8;

/** `SDD-123` -> 123. Blueprint ids are assigned by a per-kind counter, so their numeric part *is* the
 * order they were created in — the graph carries no published-at timestamp to sort by instead. */
function idSequence(ref: string): number {
  const digits = /-(\d+)$/.exec(ref);
  return digits ? Number(digits[1]) : -1;
}

function countBy<T>(items: readonly T[], key: (item: T) => string | null): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

export const getProjectStatusTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'get_project_status',
  description:
    'Reads the state of the PROJECT — the engineering line: how many documents exist per kind, how many work orders are pending/in progress/done, and which blueprints (SDD/ADR) are the most recent. Use this for questions about progress and how the work is going, e.g. "how is the project going?". Takes no arguments. For what the product itself does, use get_product_tree instead.',
  inputSchema,
  async execute(ctx: AgentToolContext) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();

    const engine = resolvePgProjectEngine(ctx.pool, ctx.neo4j, ctx.orgId, ctx.project);
    const [graph, workOrders] = await Promise.all([engine.store.fullGraph(), engine.store.listWorkOrders()]);

    const blueprints = graph.nodes
      .filter((node) => node.label === 'Blueprint')
      .sort((a, b) => idSequence(b.ref) - idSequence(a.ref))
      .slice(0, RECENT_BLUEPRINT_LIMIT)
      .map((node) => ({ id: node.ref, kind: node.kind, title: node.title, status: node.status }));

    return {
      project: ctx.project.slug,
      documentsByKind: countBy(graph.nodes, (node) => node.kind),
      workOrders: { total: workOrders.length, byStatus: countBy(workOrders, (wo) => wo.status) },
      recentBlueprints: blueprints,
    };
  },
};
