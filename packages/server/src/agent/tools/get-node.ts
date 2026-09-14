/**
 * `get_node` (SDD-009 §Herramientas): a single graph node (Feature/Blueprint/WorkOrder/...) with its
 * immediate links, exactly `GraphStore.getNode`'s own shape — the same call `/graph/node/:nodeId` (WO-142)
 * exposes to the app, already project-scoped.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { resolvePgProjectEngine } from '../../engine/resolve-pg-project-engine.js';
import { AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const inputSchema = z.object({ id: z.string().min(1).max(200) });

export const getNodeTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'get_node',
  description: 'Reads a single graph node (a document, Feature, Work Order, ...) by its id, with its immediate links. Returns { found: false } if the id does not exist in this project.',
  inputSchema,
  async execute(ctx: AgentToolContext, input) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();

    const engine = resolvePgProjectEngine(ctx.pool, ctx.neo4j, ctx.orgId, ctx.project);
    const detail = await engine.store.getNode(input.id);
    if (!detail) return { found: false };
    return { found: true, ...detail };
  },
};
