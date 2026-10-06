import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  buildForest,
  docId,
  getMetrics,
  getWorkOrderContext,
  NODE_LABELS,
  renderMermaid,
  renderText,
  triageText,
  WORK_ORDER_STATUSES,
  type Subgraph,
} from '@prdm/core';
import type { PrdmDeps } from './deps.js';
import { jsonResult, READ_ONLY, safeReadTool, textOnlyResult } from './shared.js';

const FORMATS = ['text', 'json', 'mermaid'] as const;
type Format = (typeof FORMATS)[number];

function renderSubgraph(subgraph: Subgraph, format: Format): string {
  if (format === 'json') return JSON.stringify(subgraph, null, 2);
  const forest = buildForest(subgraph);
  return format === 'mermaid' ? renderMermaid(forest) : renderText(forest);
}

export function registerReadTools(server: McpServer, deps: PrdmDeps): void {
  server.registerTool(
    'get_node',
    {
      title: 'Get node',
      description:
        'Fetches a single graph node by id (MRD/PRD/FR/SDD/ADR/WO/ART/FB) with its title, body, status and every incoming/outgoing relationship. Use this when you already know an id and need its full detail. Each node publishes source_path (the canonical published path; it may not exist on disk because in remote mode docs/ only ships model/) and mirrorPath (the readable copy that prdm sync leaves in the checkout, .prdm/remote/docs/<ID>.md).',
      inputSchema: { id: docId },
      annotations: { title: 'Get node', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ id }: { id: string }) => {
      const node = await deps.store.getNode(id);
      if (!node) throw new Error(`node ${id} not found`);
      return jsonResult({ ...node });
    }),
  );

  server.registerTool(
    'search_nodes',
    {
      title: 'Search nodes',
      description:
        'Full-text search across all graph nodes (title + body), optionally filtered by label. Use it to discover ids before calling get_node or get_feature_branch.',
      inputSchema: {
        query: z.string().min(1).max(300),
        label: z.enum(NODE_LABELS).optional(),
        limit: z.number().int().min(1).max(100).default(10),
      },
      annotations: { title: 'Search nodes', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ query, label, limit }: { query: string; label?: (typeof NODE_LABELS)[number]; limit: number }) => {
      const results = await deps.store.search(query, { labels: label ? [label] : undefined, limit });
      return jsonResult({ results });
    }),
  );

  server.registerTool(
    'get_feature_branch',
    {
      title: 'Get feature branch',
      description:
        'Returns the full lineage around one node: its ancestors up to the root Feature and its descendants down to code and commits. Use this to understand a Work Order or Blueprint before implementing it. format="text" (default) is a readable tree, "mermaid" a flowchart diagram, "json" the raw subgraph.',
      inputSchema: { id: docId, format: z.enum(FORMATS).default('text') },
      annotations: { title: 'Get feature branch', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ id, format }: { id: string; format: Format }) => {
      const subgraph = await deps.store.branch(id);
      if (subgraph.nodes.length === 0) throw new Error(`node ${id} not found`);
      if (format === 'json') return jsonResult({ nodes: subgraph.nodes, edges: subgraph.edges });
      return textOnlyResult(renderSubgraph(subgraph, format));
    }),
  );

  server.registerTool(
    'get_feature_tree',
    {
      title: 'Get feature tree',
      description:
        'Returns the entire Feature Tree forest: every MRD/PRD/FR root with its Blueprints, Work Orders, Artifacts, Feedback and governed code. Use it to get the big picture of the product graph.',
      inputSchema: { format: z.enum(FORMATS).default('text') },
      annotations: { title: 'Get feature tree', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ format }: { format: Format }) => {
      const subgraph = await deps.store.fullGraph();
      if (format === 'json') return jsonResult({ nodes: subgraph.nodes, edges: subgraph.edges });
      return textOnlyResult(renderSubgraph(subgraph, format));
    }),
  );

  server.registerTool(
    'list_work_orders',
    {
      title: 'List work orders',
      description:
        'Lists Work Orders, optionally filtered by status (pending/in_progress/done/out_of_sync) and/or the Blueprint id they implement. Use this to find work to claim. Each item publishes sourcePath (the canonical published path; it may not exist on disk because in remote mode docs/ only ships model/) and mirrorPath (the readable copy that prdm sync leaves in the checkout, .prdm/remote/docs/<ID>.md).',
      inputSchema: { status: z.enum(WORK_ORDER_STATUSES).optional(), blueprint_id: docId.optional() },
      annotations: { title: 'List work orders', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ status, blueprint_id }: { status?: (typeof WORK_ORDER_STATUSES)[number]; blueprint_id?: string }) => {
      const results = await deps.store.listWorkOrders({ status, blueprint: blueprint_id });
      return jsonResult({ results });
    }),
  );

  server.registerTool(
    'get_work_order_context',
    {
      title: 'Get work order context',
      description:
        'Builds the agent-ready context bundle for a Work Order: the WO itself, the Blueprint(s) it implements, the Feature lineage above them, related Artifacts/Feedback, the governed code paths, related commits and step-by-step instructions. Call this right after claim_work_order and before writing any code.',
      inputSchema: { id: docId },
      annotations: { title: 'Get work order context', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ id }: { id: string }) => {
      const context = await getWorkOrderContext(deps.store, id);
      if (!context) throw new Error(`work order ${id} not found`);
      return jsonResult({ ...context });
    }),
  );

  server.registerTool(
    'triage_feedback',
    {
      title: 'Triage feedback',
      description:
        'Ranks existing Features against a piece of free text using explicit id mentions and the full-text index; does not create or link anything. Read `autoLinkTo`/`reason` to see whether the text clearly matches an existing Feature, and use `candidates`/`proposal` to decide whether to call create_feature_request yourself.',
      inputSchema: { text: z.string().min(1).max(20_000) },
      annotations: { title: 'Triage feedback', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ text }: { text: string }) => jsonResult({ ...(await triageText(deps.store, deps.config, text)) })),
  );

  server.registerTool(
    'get_metrics',
    {
      title: 'Get metrics',
      description:
        'Returns the success metrics of the graph: agent/human resolution efficiency for Work Orders, GOVERNED_BY sync integrity, and Feature/commit traceability.',
      inputSchema: {},
      annotations: { title: 'Get metrics', ...READ_ONLY },
    },
    safeReadTool(deps, async () => jsonResult({ ...(await getMetrics(deps.store)) })),
  );
}
