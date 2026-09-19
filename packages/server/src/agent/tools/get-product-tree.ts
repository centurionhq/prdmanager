/**
 * `get_product_tree` (SDD-037/PRD-016, WO-477): the **product** at a glance — the feature forest
 * MRD → BC → PRD/FR, what is being built and how each piece is justified. Its counterpart is
 * `./get-project-status.ts` (the engineering line), and the two stay strictly apart on purpose: mixing
 * blueprints, work orders and commits into the feature tree is precisely the confusion this pair exists
 * to remove — and precisely the bug PRD-013 fixed on the Árbol screen for the same reason.
 *
 * Takes no arguments, like its counterpart, so it can answer an opening question.
 *
 * Nesting follows the rule the Árbol screen already uses (`buildFeatureForest`, `ProjectGraph.tsx`,
 * SDD-029): a `PRD`/`FR` hangs off the `BC` that justifies it, everything else off its `EVOLVES_FROM`
 * parent. Rebuilt here from `fullGraph()`'s edges rather than shared with the client, which derives it
 * from a `/graph/tree` response this side of the system has no equivalent of.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import type { Subgraph, SubgraphNode } from '@prdm/core';
import { resolvePgProjectEngine } from '../../engine/resolve-pg-project-engine.js';
import { AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const inputSchema = z.object({});

interface ProductNode {
  id: string;
  kind: string | null;
  title: string;
  status: string | null;
  children: ProductNode[];
}

/** Guards against a cycle in the graph (`EVOLVES_FROM` is not enforced acyclic) turning the walk into
 * infinite recursion, and against a pathological chain blowing the output budget. */
const MAX_DEPTH = 8;

/**
 * The parent of every feature: its justifying `BC` when it has one, otherwise its `EVOLVES_FROM` target.
 * A feature with neither is a root.
 */
function parentOf(graph: Subgraph, features: ReadonlyMap<string, SubgraphNode>): ReadonlyMap<string, string> {
  const parent = new Map<string, string>();
  for (const edge of graph.edges) {
    if (!features.has(edge.from) || !features.has(edge.to)) continue;
    if (edge.type === 'EVOLVES_FROM' && !parent.has(edge.from)) parent.set(edge.from, edge.to);
  }
  // Second pass, so a JUSTIFIED_BY edge into a BC always wins over an EVOLVES_FROM already recorded.
  for (const edge of graph.edges) {
    if (edge.type !== 'JUSTIFIED_BY') continue;
    if (!features.has(edge.from) || features.get(edge.to)?.kind !== 'BC') continue;
    parent.set(edge.from, edge.to);
  }
  return parent;
}

/**
 * Budget for the serialized tree, in bytes, comfortably under the dispatcher's ~20 KB
 * `TOOL_OUTPUT_MAX_BYTES` with room for the wrapper fields. The dispatcher enforces that cap by cutting
 * the string, which would hand the model invalid JSON ending mid-feature with nothing to say it was
 * cut. Budgeting here instead keeps the output well-formed and makes it say, via
 * `truncated`/`totalFeatures`, that there is more — the model can then go get the rest with
 * `get_feature_branch`.
 *
 * Counted in bytes rather than in nodes because a node's cost is mostly its title, and titles in this
 * project run from a few words to a full sentence: any fixed node count either truncates a small tree
 * needlessly or blows the byte cap on a wordy one.
 */
const MAX_TREE_BYTES = 16 * 1024;

/** Braces, quotes, the four field names and the `children` array for one serialized node. */
const NODE_JSON_OVERHEAD = 70;

function nodeCost(node: SubgraphNode): number {
  return NODE_JSON_OVERHEAD + Buffer.byteLength(`${node.ref}${node.kind ?? ''}${node.title}${node.status ?? ''}`, 'utf8');
}

export interface ProductForest {
  features: ProductNode[];
  /** Every feature in the project, including any this tree left out. */
  totalFeatures: number;
  truncated: boolean;
}

export function buildProductForest(graph: Subgraph): ProductForest {
  const features = new Map(graph.nodes.filter((node) => node.label === 'Feature').map((node) => [node.ref, node]));
  const parent = parentOf(graph, features);

  const childrenOf = new Map<string, string[]>();
  for (const [child, father] of parent) childrenOf.set(father, [...(childrenOf.get(father) ?? []), child]);

  let budget = MAX_TREE_BYTES;

  /** An explicit loop, not `filter(() => budget > 0).map(build)`: `filter` runs to completion *before*
   * `map` ever decrements the budget, so that version silently spends nothing and emits everything. */
  function buildEach(refs: readonly string[], depth: number, seen: ReadonlySet<string>): ProductNode[] {
    const built: ProductNode[] = [];
    for (const ref of [...refs].sort((a, b) => a.localeCompare(b))) {
      if (budget <= 0) break;
      built.push(build(ref, depth, new Set([...seen, ref])));
    }
    return built;
  }

  function build(ref: string, depth: number, seen: ReadonlySet<string>): ProductNode {
    const node = features.get(ref)!;
    budget -= nodeCost(node);
    const children = depth >= MAX_DEPTH ? [] : (childrenOf.get(ref) ?? []).filter((child) => !seen.has(child));
    return {
      id: node.ref,
      kind: node.kind,
      title: node.title,
      status: node.status,
      children: buildEach(children, depth + 1, seen),
    };
  }

  const rootRefs = [...features.keys()].filter((ref) => !parent.has(ref));
  const roots = buildEach(rootRefs, 0, new Set());

  return { features: roots, totalFeatures: features.size, truncated: budget <= 0 };
}

export const getProductTreeTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'get_product_tree',
  description:
    'Reads the PRODUCT — the feature tree (MRD → BC → PRD/FR) with each feature’s id, title and status, nested so a PRD/FR sits under the business case that justifies it. Use this for questions about what the product does and why it is justified, e.g. "what does the product do?". Takes no arguments. It deliberately excludes blueprints, work orders, commits and code; for those, use get_project_status.',
  inputSchema,
  async execute(ctx: AgentToolContext) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();

    const engine = resolvePgProjectEngine(ctx.pool, ctx.neo4j, ctx.orgId, ctx.project);
    return { project: ctx.project.slug, ...buildProductForest(await engine.store.fullGraph()) };
  },
};
