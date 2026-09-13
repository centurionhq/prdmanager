import type { NodeLabel, ParsedDoc } from '../domain/schema.js';
import type { CommitInfo } from '../sync/git.js';
import type { GovernedState } from '../sync/monitor.js';

export interface GraphSnapshot {
  docs: ParsedDoc[];
  governed: (GovernedState & { hash: string | null })[];
  reviewNeeded: { blueprintId: string; featureId: string }[];
  commits: CommitInfo[];
}

export interface NodeView {
  id: string;
  label: NodeLabel;
  kind: string;
  title: string;
  status: string;
  body: string;
  tags: string[];
  source_path: string;
  created_at: string | null;
  [prop: string]: unknown;
}

export interface NodeLink {
  type: string;
  direction: 'in' | 'out';
  ref: string;
  title: string;
  props: Record<string, unknown>;
}

export interface NodeDetail {
  node: NodeView;
  links: NodeLink[];
}

export interface SearchHit {
  id: string;
  label: NodeLabel;
  title: string;
  status: string;
  score: number;
}

export interface SubgraphNode {
  ref: string;
  label: string;
  kind: string | null;
  title: string;
  status: string | null;
}

export interface SubgraphEdge {
  from: string;
  to: string;
  type: string;
  status: string | null;
  reviewNeeded: boolean;
}

export interface Subgraph {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
}

export interface WorkOrderSummary {
  id: string;
  title: string;
  status: string;
  assignedTo: string | null;
  blueprints: string[];
  sourcePath: string;
}

export interface WorkOrderContextRaw {
  workOrder: NodeView;
  blueprints: NodeView[];
  features: NodeView[];
  context: (NodeView & { label: NodeLabel })[];
  code: { key: string; path: string; symbol: string | null; status: string; reason: string; blueprint: string }[];
  commits: { sha: string; subject: string; author: string; date: string }[];
}

export interface MetricsRaw {
  governedTotal: number;
  governedSynced: number;
  featuresTotal: number;
  featuresTraced: number;
  commitsTotal: number;
  commitsWithRefs: number;
  commitsTraced: number;
  workOrders: { id: string; status: string; claimedAt: string | null; completedAt: string | null }[];
}

/** Storage port: domain code depends on this, never on Cypher. */
export interface GraphStore {
  verify(): Promise<void>;
  migrate(): Promise<void>;
  clear(): Promise<void>;
  writeSnapshot(snapshot: GraphSnapshot): Promise<void>;
  getNode(id: string): Promise<NodeDetail | null>;
  search(text: string, options?: { labels?: NodeLabel[]; limit?: number }): Promise<SearchHit[]>;
  branch(id: string): Promise<Subgraph>;
  fullGraph(): Promise<Subgraph>;
  listWorkOrders(filter?: { status?: string; blueprint?: string }): Promise<WorkOrderSummary[]>;
  workOrderContext(id: string): Promise<WorkOrderContextRaw | null>;
  metricsRaw(): Promise<MetricsRaw>;
  close(): Promise<void>;
}
