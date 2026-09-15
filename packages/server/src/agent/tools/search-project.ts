/**
 * `search_project` (SDD-009 §Herramientas): full-text search over the project's published graph, via the
 * exact same `GraphStore.search` every human-facing search path (CLI `prdm search`, the app's search box)
 * already uses — already project-scoped (the `GraphStore` instance is bound to one project's Neo4j
 * subtree), so this tool structurally cannot leak another project's content.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { resolvePgProjectEngine } from '../../engine/resolve-pg-project-engine.js';
import { AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 10;

const inputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
});

export const searchProjectTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'search_project',
  description: 'Full-text searches this project’s published documents/features and returns the best-matching nodes (id, label, title, status, score).',
  inputSchema,
  async execute(ctx: AgentToolContext, input) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();

    const engine = resolvePgProjectEngine(ctx.pool, ctx.neo4j, ctx.orgId, ctx.project);
    const hits = await engine.store.search(input.query, { limit: input.limit ?? DEFAULT_LIMIT });
    return { hits };
  },
};
