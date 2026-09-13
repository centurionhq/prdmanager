import type { Driver } from 'neo4j-driver';
import type { NodeLabel } from '../domain/schema.js';
import { assertProjectId, type ProjectRef } from '../project/types.js';
import { CLEAR_PROJECT } from './queries.js';
import * as reads from './store-read.js';
import { writeSnapshot } from './store-write.js';
import type { GraphSnapshot, GraphStore, MetricsRaw, NodeDetail, SearchHit, Subgraph, WorkOrderContextRaw, WorkOrderSummary } from './types.js';

/**
 * Project-scoped `GraphStore` (ADR-002 D1): every method is bound to one `ProjectRef` and every query it runs is
 * parameterized with that project's id (see `graph/queries.ts`), so isolation does not depend on callers
 * remembering to filter. Instances are only created by `Neo4jGraphDatabase.forProject`; they share its driver and
 * have no independent connection lifecycle (`verify`/`migrate`/`close` live on `GraphDatabase`).
 */
export class Neo4jGraphStore implements GraphStore {
  constructor(
    private readonly driver: Driver,
    private readonly database: string,
    private readonly project: ProjectRef,
  ) {
    assertProjectId(project.id);
  }

  /** Deletes only this project's Node/CodeRef/Commit/Actor nodes; the `(:Project)` node is kept so its root fingerprint survives a reset. */
  async clear(): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.run(CLEAR_PROJECT, { projectId: this.project.id });
    } finally {
      await session.close();
    }
  }

  async writeSnapshot(snapshot: GraphSnapshot): Promise<void> {
    await writeSnapshot(this.driver, this.database, this.project, snapshot);
  }

  async getNode(id: string): Promise<NodeDetail | null> {
    return reads.getNode(this.driver, this.database, this.project.id, id);
  }

  async search(text: string, options: { labels?: NodeLabel[]; limit?: number } = {}): Promise<SearchHit[]> {
    return reads.search(this.driver, this.database, this.project.id, text, options);
  }

  async branch(id: string): Promise<Subgraph> {
    return reads.branch(this.driver, this.database, this.project.id, id);
  }

  async fullGraph(): Promise<Subgraph> {
    return reads.fullGraph(this.driver, this.database, this.project.id);
  }

  async listWorkOrders(filter: { status?: string; blueprint?: string } = {}): Promise<WorkOrderSummary[]> {
    return reads.listWorkOrders(this.driver, this.database, this.project.id, filter);
  }

  async workOrderContext(id: string): Promise<WorkOrderContextRaw | null> {
    return reads.workOrderContext(this.driver, this.database, this.project.id, id);
  }

  async metricsRaw(): Promise<MetricsRaw> {
    return reads.metricsRaw(this.driver, this.database, this.project.id);
  }
}
