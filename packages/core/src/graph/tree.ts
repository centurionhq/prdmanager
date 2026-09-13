import type { Subgraph, SubgraphEdge, SubgraphNode } from './types.js';

export interface TreeNode {
  ref: string;
  label: string;
  kind: string | null;
  title: string;
  status: string | null;
  via: string | null;
  edgeStatus: string | null;
  reviewNeeded: boolean;
  repeated: boolean;
  children: TreeNode[];
}

const ROOT_LABELS = new Set(['Feature', 'Blueprint', 'WorkOrder', 'Artifact', 'Feedback']);
const LABEL_ORDER = ['Feature', 'Blueprint', 'WorkOrder', 'Commit', 'CodeRef', 'Artifact', 'Feedback'];
const orderOf = (label: string): number => {
  const i = LABEL_ORDER.indexOf(label);
  return i === -1 ? LABEL_ORDER.length : i;
};

/** Builds a top-down forest: every hierarchical edge points child -> parent, roots are document nodes without parents. */
export function buildForest(graph: Subgraph): TreeNode[] {
  const byRef = new Map(graph.nodes.map((n) => [n.ref, n]));
  const edges = graph.edges.filter((e) => byRef.has(e.from) && byRef.has(e.to));
  const childEdges = (ref: string): SubgraphEdge[] =>
    edges
      .filter((e) => e.to === ref)
      .sort((a, b) => {
        const na = byRef.get(a.from) as SubgraphNode;
        const nb = byRef.get(b.from) as SubgraphNode;
        return orderOf(na.label) - orderOf(nb.label) || na.ref.localeCompare(nb.ref);
      });
  const hasParent = new Set(edges.map((e) => e.from));
  const rendered = new Set<string>();

  const visit = (node: SubgraphNode, edge: SubgraphEdge | null): TreeNode => {
    const repeated = rendered.has(node.ref);
    rendered.add(node.ref);
    return {
      ref: node.ref,
      label: node.label,
      kind: node.kind,
      title: node.title,
      status: node.status,
      via: edge?.type ?? null,
      edgeStatus: edge?.status ?? null,
      reviewNeeded: edge?.reviewNeeded ?? false,
      repeated,
      children: repeated ? [] : childEdges(node.ref).map((e) => visit(byRef.get(e.from) as SubgraphNode, e)),
    };
  };

  return graph.nodes
    .filter((n) => ROOT_LABELS.has(n.label) && !hasParent.has(n.ref))
    .sort((a, b) => orderOf(a.label) - orderOf(b.label) || a.ref.localeCompare(b.ref))
    .map((n) => visit(n, null));
}

function describe(node: TreeNode): string {
  const kind = node.kind && node.kind !== node.label ? `/${node.kind}` : '';
  const status = node.status ? ` (${node.status})` : '';
  const edge = node.edgeStatus ? ` [${node.edgeStatus === 'synced' ? 'synced' : `OUT OF SYNC`}]` : '';
  const review = node.reviewNeeded ? ' [REVIEW NEEDED]' : '';
  const repeated = node.repeated ? ' (see above)' : '';
  return `${node.ref} <${node.label}${kind}> ${node.title}${status}${edge}${review}${repeated}`;
}

export function renderText(forest: TreeNode[]): string {
  const lines: string[] = [];
  const walk = (node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
    lines.push(isRoot ? describe(node) : `${prefix}${isLast ? '└─ ' : '├─ '}${describe(node)}`);
    const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : '│  '}`;
    node.children.forEach((child, i) => walk(child, childPrefix, i === node.children.length - 1, false));
  };
  forest.forEach((root) => walk(root, '', true, true));
  return lines.join('\n');
}

export function renderMermaid(forest: TreeNode[]): string {
  const ids = new Map<string, string>();
  const nodeLines: string[] = [];
  const edgeLines: string[] = [];
  const outOfSync: string[] = [];
  const idOf = (node: TreeNode): string => {
    const existing = ids.get(node.ref);
    if (existing) return existing;
    const id = `n${ids.size}`;
    ids.set(node.ref, id);
    const text = `${node.ref}: ${node.title}${node.status ? ` (${node.status})` : ''}`.replace(/"/g, '#quot;');
    nodeLines.push(`  ${id}["${text}"]`);
    return id;
  };
  const walk = (node: TreeNode): void => {
    const parentId = idOf(node);
    for (const child of node.children) {
      const childId = idOf(child);
      edgeLines.push(`  ${parentId} -->|${child.via ?? ''}| ${childId}`);
      if (child.edgeStatus === 'out_of_sync' || child.status === 'out_of_sync') outOfSync.push(childId);
      walk(child);
    }
  };
  forest.forEach(walk);
  const style = outOfSync.length ? ['  classDef drift fill:#fdd,stroke:#c00', `  class ${[...new Set(outOfSync)].join(',')} drift`] : [];
  return ['flowchart TD', ...nodeLines, ...edgeLines, ...style].join('\n');
}
