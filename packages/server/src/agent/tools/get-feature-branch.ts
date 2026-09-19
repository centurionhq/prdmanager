/**
 * `get_feature_branch` (SDD-009 §Herramientas): the full lineage rooted at a single node (typically a
 * Feature) — reuses `GraphStore.branch`, the same subgraph `/graph/tree?root=` (WO-142) renders.
 *
 * WO-517 (SDD-045/FB-025): structure only, never document bodies. Four calls to this tool accounted for
 * 79_662 bytes of one turn's context, almost all of it the body of every node in the branch. This is
 * the structural tool par excellence — a whole branch of the tree — and there is no case for carrying a
 * dozen documents' text through it. Whoever wants to read one asks `get_node` for it, by id.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { resolvePgProjectEngine } from '../../engine/resolve-pg-project-engine.js';
import { AgentToolPermissionError, type AgentToolContext } from './context.js';
import { toStructuralNode } from './get-node.js';
import type { AgentTool } from './tool.js';

const inputSchema = z.object({ featureId: z.string().min(1).max(200) });

export const getFeatureBranchTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'get_feature_branch',
  description:
    'Reads the full branch of nodes and edges rooted at a Feature (or any node) id, e.g. a Feature and everything it architects/informs. Structure only — ids, kinds, titles, statuses and edges; document bodies are never included here. To read one of those documents, call get_node with includeBody: true. Returns { found: false } if the root id does not exist.',
  inputSchema,
  async execute(ctx: AgentToolContext, input) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();

    const engine = resolvePgProjectEngine(ctx.pool, ctx.neo4j, ctx.orgId, ctx.project);
    const node = await engine.store.getNode(input.featureId);
    if (!node) return { found: false };
    const subgraph = await engine.store.branch(input.featureId);
    return { found: true, ...subgraph, nodes: subgraph.nodes.map((n) => toStructuralNode(n as unknown as Record<string, unknown>, false)) };
  },
};
