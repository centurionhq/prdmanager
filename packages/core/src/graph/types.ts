import type { NodeLabel, ParsedDoc } from '../domain/schema.js';
import type { CommitInfo } from '../sync/git.js';
import type { GovernedState } from '../sync/monitor.js';
import type { ProjectRef } from '../project/types.js';

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

export type WorkOrderActorKind = 'agent' | 'dev' | 'unassigned';

export interface WorkOrderQueryFilter {
  status?: string;
  blueprint?: string;
  actorKind?: WorkOrderActorKind;
  assignedTo?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface WorkOrderStatusCounts {
  /** Base sin `archived` (coherente con D3: el chip "Todas" == default). */
  all: number;
  pending: number;
  in_progress: number;
  out_of_sync: number;
  done: number;
  archived: number;
}

export interface WorkOrderPage {
  items: WorkOrderSummary[];
  /** Conteo del conjunto con TODOS los filtros (incl. estado/D3). */
  total: number;
  /** Base filtrada por blueprint/actorKind/assignedTo/q, SIN estado. */
  statusCounts: WorkOrderStatusCounts;
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

export interface ProjectRecord {
  id: string;
  name: string;
  /** Realpath of the checkout that owns the partition (SDD-002 "Proyecto activo"). */
  rootFingerprint: string;
  updatedAt: string | null;
  nodeCount: number;
}

export interface SchemaStatus {
  /** Highest applied (:SchemaMigration) version, 0 when none. */
  current: number;
  /** Version this build of @prdm/core expects. */
  expected: number;
  pending: { version: number; name: string; destructive: boolean }[];
}

/**
 * Database-level port (ADR-002 D1/D3): owns the driver, schema migrations and projects.
 * Project-scoped reads/writes go through `forProject`, so no query can omit the project filter.
 */
export interface GraphDatabase {
  verify(): Promise<void>;
  schemaStatus(): Promise<SchemaStatus>;
  /** Applies pending migrations, including destructive ones; only `prdm db migrate` may call this. */
  migrate(): Promise<SchemaStatus>;
  /** Throws unless schema is exactly at the expected version (clients refuse unknown or older schemas). */
  assertSchemaCurrent(): Promise<void>;
  forProject(project: ProjectRef): GraphStore;
  listProjects(): Promise<ProjectRecord[]>;
  /** Reassigns the partition fingerprint to `project.root` (e.g. after moving the checkout). */
  claimProject(project: ProjectRef): Promise<void>;
  dropProject(projectId: string): Promise<void>;
  /** `prdm db doctor` (ADR-002 consequences): counts Node/CodeRef/Commit/Actor nodes missing `project_id` across every project. */
  orphanCounts(): Promise<{ label: string; count: number }[]>;
  close(): Promise<void>;
}

/**
 * Project-scoped storage port: domain code depends on this, never on Cypher (ADR-002 D1).
 * `verify`/`migrate`/`close` live on `GraphDatabase`: a scoped store shares the database's driver and has no
 * independent connection lifecycle, so it cannot accidentally verify/migrate/close on behalf of the whole database.
 */
export interface GraphStore {
  /** Deletes only this project's partition (Node/CodeRef/Commit/Actor); the `(:Project)` node itself is kept so its root fingerprint survives a reset. */
  clear(): Promise<void>;
  writeSnapshot(snapshot: GraphSnapshot): Promise<void>;
  getNode(id: string): Promise<NodeDetail | null>;
  search(text: string, options?: { labels?: NodeLabel[]; limit?: number }): Promise<SearchHit[]>;
  branch(id: string): Promise<Subgraph>;
  fullGraph(): Promise<Subgraph>;
  listWorkOrders(filter?: { status?: string; blueprint?: string }): Promise<WorkOrderSummary[]>;
  queryWorkOrders(filter?: WorkOrderQueryFilter): Promise<WorkOrderPage>;
  workOrderContext(id: string): Promise<WorkOrderContextRaw | null>;
  metricsRaw(): Promise<MetricsRaw>;
}
