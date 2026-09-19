/**
 * `get_node` (SDD-009 §Herramientas): a single graph node (Feature/Blueprint/WorkOrder/...) with its
 * immediate links, from `GraphStore.getNode` — the same call `/graph/node/:nodeId` (WO-142) exposes to
 * the app, already project-scoped.
 *
 * WO-516 (SDD-045/FB-025): it no longer returns the document's body unless asked. Measured on a real
 * turn, a single `get_node` result was 12_328 bytes of which `body` was 10_636 — 86 %. The agent called
 * it twelve times to walk the graph and dragged ~100 KB of markdown into the conversation to answer a
 * purely structural question, leaving no context left to write the answer with.
 *
 * Walking the graph and reading a document are two different questions; this tool now answers the first
 * and offers the second on request. Nothing is out of reach — the body is one explicit argument away —
 * but it stops arriving twelve times over as a side effect.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { resolvePgProjectEngine } from '../../engine/resolve-pg-project-engine.js';
import { AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const inputSchema = z.object({
  id: z.string().min(1).max(200),
  /** WO-516: opt-in, because the body is the expensive part and most reads do not need it. */
  includeBody: z.boolean().optional(),
});

/**
 * WO-518: fields that exist for the server's own bookkeeping and that the model can do nothing with —
 * `project_id` and `content_hash` are opaque identifiers it can never use in a later call, and
 * `tags_text` is `tags` again as a string. Small individually, but they ride along on every node of
 * every branch.
 */
const INTERNAL_FIELDS = ['project_id', 'content_hash', 'tags_text'] as const;

/** Strips `body` (unless asked for) and the internal bookkeeping fields from a node-shaped object. */
export function toStructuralNode(node: Record<string, unknown>, includeBody: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if ((INTERNAL_FIELDS as readonly string[]).includes(key)) continue;
    if (key === 'body' && !includeBody) continue;
    out[key] = value;
  }
  return out;
}

export const getNodeTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'get_node',
  description:
    'Reads a single graph node (a document, Feature, Work Order, ...) by its id: its kind, title, status and immediate links. The document’s body is NOT included unless you pass includeBody: true — ask for it only when you actually need to read the text. Returns { found: false } if the id does not exist in this project.',
  inputSchema,
  async execute(ctx: AgentToolContext, input) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();

    const engine = resolvePgProjectEngine(ctx.pool, ctx.neo4j, ctx.orgId, ctx.project);
    const detail = await engine.store.getNode(input.id);
    if (!detail) return { found: false };

    const { node, ...rest } = detail as unknown as { node?: Record<string, unknown> } & Record<string, unknown>;
    // `getNode`'s shape has varied across callers; handle both a nested `node` and a flat object rather
    // than assuming one and silently returning the body anyway.
    if (node) return { found: true, ...rest, node: toStructuralNode(node, input.includeBody === true) };
    return { found: true, ...toStructuralNode(rest, input.includeBody === true) };
  },
};
