import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  attributeIssue,
  buildForest,
  checkLifecycle,
  deriveLineBoard,
  docId,
  getMetrics,
  getWorkOrderContext,
  LABEL_BY_KIND,
  mirrorPathFor,
  NODE_LABELS,
  renderMermaid,
  renderText,
  STATIONS,
  triageText,
  WORK_ORDER_STATUSES,
  type NodeDetail,
  type ParsedDoc,
  type Station,
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

/** SDD-067 D2: the graph only holds published documents, so a draft/in_review one is looked up through the
 * documents port (remote profile only). `null` when there is no port or the port doesn't see the document. */
async function unpublishedNode(deps: PrdmDeps, id: string): Promise<NodeDetail | null> {
  if (!deps.documents) return null;
  const found = await deps.documents.get(id);
  if (!found) return null;
  const { document, latestVersion } = found;
  return {
    node: {
      id: document.docId,
      label: LABEL_BY_KIND[document.kind],
      kind: document.kind,
      title: document.title,
      status: document.workflowState,
      body: latestVersion?.renderedMarkdown ?? '',
      tags: [],
      source_path: document.sourcePath,
      mirrorPath: mirrorPathFor(document.docId),
      created_at: null,
      workflowState: document.workflowState,
      indexed: false,
    },
    links: [],
  };
}

/** One reason a document cannot move on: the lifecycle issue's own `kind` and message, and the station the
 * line board attributes it to (`null` when the issue kind maps to no station, never a guess). */
export interface PromotionBlocker {
  code: string;
  message: string;
  station: Station | null;
}

/** SDD-125 D5 ("qué le falta" es lectura, no adivinanza). */
export interface Promotion {
  /** Every lifecycle issue that stops the line at this document, in the order `checkLifecycle` emits them. */
  blocking: PromotionBlocker[];
  /** The earliest station this document is blocked at, or -- with nothing blocking -- the station right
   * after the one the line board places it on. `null` when neither can be derived (no row on the board and
   * nothing blocking, or an `entregado` row). */
  nextStation: Station | null;
}

const stationIndex = (station: Station): number => STATIONS.indexOf(station);

/** The station `deriveLineBoard` places `id` on, searching BC rows' nested children too; `null` when the
 * board has no row for it (a Work Order, Feedback or Artifact never gets one). */
function boardStation(docs: readonly ParsedDoc[], id: string): Station | null {
  const pending = [...deriveLineBoard(docs).features];
  while (pending.length > 0) {
    const line = pending.shift();
    if (line === undefined) break;
    if (line.id === id) return line.station;
    pending.push(...line.children);
  }
  return null;
}

/**
 * SDD-125 D5: what a document still needs before it can pass its station. Derived from the same lifecycle
 * issues and the same station attribution the drift report and the line board already use -- `edit` mode is
 * not used here: promotion is the publish question, so the SDD-124/125 rules that block publishing are errors
 * (`mode: 'publish'`), and a warning only blocks when its attribution says it stops the line
 * (`feature_without_blueprint`, SDD-125 D4).
 */
export async function promotionFor(deps: PrdmDeps, id: string): Promise<Promotion> {
  const { docs } = await deps.engine.scan();
  const issues = checkLifecycle(docs, { grandfathered: deps.config.lifecycle?.grandfathered ?? [], mode: 'publish' });

  const blocking: PromotionBlocker[] = [];
  for (const issue of issues) {
    if (issue.nodeId !== id) continue;
    const attribution = attributeIssue(issue, docs);
    if (issue.severity !== 'error' && attribution.stopsLine !== true) continue;
    blocking.push({ code: issue.kind, message: issue.message, station: attribution.station });
  }

  const blockerStations = blocking.map((blocker) => blocker.station).filter((station): station is Station => station !== null);
  if (blockerStations.length > 0) {
    return { blocking, nextStation: blockerStations.reduce((earliest, station) => (stationIndex(station) < stationIndex(earliest) ? station : earliest)) };
  }

  const current = boardStation(docs, id);
  return { blocking, nextStation: current === null ? null : (STATIONS[stationIndex(current) + 1] ?? null) };
}

export function registerReadTools(server: McpServer, deps: PrdmDeps): void {
  server.registerTool(
    'get_node',
    {
      title: 'Get node',
      description:
        'Fetches a single graph node by id (MRD/PRD/FR/SDD/ADR/WO/ART/FB) with its title, body, status and every incoming/outgoing relationship. Use this when you already know an id and need its full detail. If the id is not in the graph, falls back to the project\'s unpublished documents: a draft/in_review document comes back with its real workflowState, indexed: false and no links. Each node publishes source_path (the canonical published path; it may not exist on disk because in remote mode docs/ only ships model/) and mirrorPath (the readable copy that prdm sync leaves in the checkout, .prdm/remote/docs/<ID>.md). Each node also publishes promotion: {blocking: [{code, message, station}], nextStation}. blocking lists the lifecycle issues that stop the line at this document (an error, or the design-hole warning that stops an approved feature at diseno_tecnico) with the station each one is attributed to; nextStation is the earliest blocking station, or -- with nothing blocking -- the station right after the one the line board places the document on (null when it has no row or is already delivered). Both come from the same rules the drift report and the line board use, never a second copy.',
      inputSchema: { id: docId },
      annotations: { title: 'Get node', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ id }: { id: string }) => {
      const node = (await deps.store.getNode(id)) ?? (await unpublishedNode(deps, id));
      if (!node) throw new Error(`node ${id} not found`);
      return jsonResult({ ...node, promotion: await promotionFor(deps, id) });
    }),
  );

  server.registerTool(
    'search_nodes',
    {
      title: 'Search nodes',
      description:
        'Full-text search across all graph nodes (title + body), optionally filtered by label. Only indexes published documents: a draft/in_review document does not appear here, fetch it by id with get_node instead. Use it to discover ids before calling get_node or get_feature_branch.',
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
        'Lists Work Orders, optionally filtered by status (pending/in_progress/done/out_of_sync) and/or the Blueprint id they implement. Use this to find work to claim. Each item publishes sourcePath (the canonical published path; it may not exist on disk because in remote mode docs/ only ships model/) and mirrorPath (the readable copy that prdm sync leaves in the checkout, .prdm/remote/docs/<ID>.md). Each item also publishes createdAt and claimedAt exactly as the node has them (null when the node has no such date) and ageDays (complete days since createdAt, computed at read time; null without a date). assignedTo is null while nobody has taken the order: in remote mode a pending order is not assigned and no owner is invented; it only carries one once someone claims it. Each item also publishes landedCommitSha: the sha of the most recent commit whose Refs: trailer names this order (null when none). When it is set the work already landed in the graph and completing the order only needs that sha — the mark never closes the order by itself.',
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
        'Returns the success metrics of the graph: agent/human resolution efficiency for Work Orders, GOVERNED_BY sync integrity, and Feature/commit traceability. The traceability denominator is the Feature Tree (MRD/PRD/FR): a Business Case (kind BC) does NOT count in featuresTotal, featuresTraced, featurePercent or orphanFeatures. traceability.featuresByKind carries the full breakdown ({kind, total, traced}, ordered MRD, PRD, FR, BC, one entry per kind present, BC included). traceability.orphanFeatures lists every Feature-Tree node (id, kind, title, status) whose lineage has no Blueprint with governed code, so the caller sees which Features are actually untraced without a second call; the list is empty when every Tree node is traced. It comes from the same definition as traceability.featuresTraced, so featuresTraced + orphanFeatures.length always equals featuresTotal of the Tree, and sum(featuresByKind.total) equals every indexed Feature node (BC included). The efficiency aggregate (avgResolutionHours, medianResolutionHours, measuredWorkOrders) excludes completed Work Orders that cannot be measured; that gap and the ids are in agentHumanEfficiency.unmeasured (total + workOrders with id, status, reason, claimedAt, completedAt, ordered by id), so measuredWorkOrders + unmeasured.total always equals completedWorkOrders. The same block adds p90ResolutionHours (90th percentile, linearly interpolated), maxResolutionHours and slowest {thresholdHours, total, items}: total is the number of measured orders above the threshold (strict, > thresholdHours) and items are up to 10 of the slowest {id, claimedAt, completedAt, resolutionHours} sorted descending, so slowest.items.length is always min(slowest.total, 10). traceability.untracedCommits travels in the same call: total (commits without Refs plus commits whose Refs resolve to no Work Order chain), danglingRefs (the subset that has Refs that do not resolve; otherwise invisible), truncated (true when the graph has more than 200) and items (up to 200 {sha, subject, author, date, files, gap} with gap in {no_refs, dangling_refs}). total == commitsTotal - commitsTraced and danglingRefs == commitsWithRefs - commitsTraced. traceability.commitsWindow {branch, sha, reportedAt} names the window the commits were computed over (branch, sha and date of the current CI report), each null when the report does not declare it, never inferred. untracedCommits.byClass {merge, bookkeeping, code} (and items[].class) breaks the gap down; byClass is computed in the same aggregation as total, not from the capped items list, so merge + bookkeeping + code === total, and only the code rows are work. capacities.windows holds two windows (days 7 and 30), each with createdByKind (always all 7 kinds, each {kind, total}), features (for PRD and FR: created, withDesign, withWorkOrders, delivered), feedback (created, new, triaged, closed, pendingClose) and passageExceptions. The sums that close: sum(createdByKind.total) = documents created in the window; feedback.new + feedback.triaged + feedback.closed = feedback.created; delivered <= withWorkOrders <= withDesign <= created; pendingClose counts ALL open feedbacks that already have delivered work (not only those created in the window).',
      inputSchema: {},
      annotations: { title: 'Get metrics', ...READ_ONLY },
    },
    safeReadTool(deps, async () => jsonResult({ ...(await getMetrics(deps.store, (await deps.engine.scan()).docs)) })),
  );
}
