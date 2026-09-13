import neo4j, { type Driver, type ManagedTransaction } from 'neo4j-driver';
import type { Neo4jConfig } from '../config.js';
import { NODE_LABELS, type NodeLabel } from '../domain/schema.js';
import { buildLuceneQuery } from './lucene.js';
import { MIGRATIONS } from './migrations.js';
import type {
  GraphSnapshot,
  GraphStore,
  MetricsRaw,
  NodeDetail,
  SearchHit,
  Subgraph,
  WorkOrderContextRaw,
  WorkOrderSummary,
} from './types.js';

const LABEL_OF = `[l IN labels(n) WHERE l <> 'Node'][0]`;
const UP_FILTER = 'EVOLVES_FROM>|ARCHITECTS>|IMPLEMENTS>|PROVIDES_CONTEXT_FOR>|INFORMS>';
const DOWN_FILTER = '<EVOLVES_FROM|<ARCHITECTS|<IMPLEMENTS|<PROVIDES_CONTEXT_FOR|<INFORMS|<GOVERNED_BY|<RESOLVES';
const MAX_DEPTH = 25;

const SUBGRAPH_PROJECTION = `
  RETURN [n IN ns | {ref: n.ref, label: ${LABEL_OF}, kind: n.kind, title: coalesce(n.title, n.subject, n.key, n.id), status: n.status}] AS nodes,
         [r IN rs | {from: startNode(r).ref, to: endNode(r).ref, type: type(r), status: r.status, reviewNeeded: coalesce(r.review_needed, false)}] AS edges`;

function groupActors(docs: GraphSnapshot['docs']): { id: string; kind: string; workOrders: string[] }[] {
  const assigned = docs.flatMap((d) => (d.actor ? [{ actor: d.actor, workOrder: d.node.id }] : []));
  const ids = [...new Set(assigned.map((a) => a.actor.id))];
  return ids.map((id) => {
    const entries = assigned.filter((a) => a.actor.id === id);
    return { id, kind: entries[0]?.actor.kind ?? 'developer', workOrders: entries.map((e) => e.workOrder) };
  });
}

export class Neo4jGraphStore implements GraphStore {
  private constructor(
    private readonly driver: Driver,
    private readonly database: string,
  ) {}

  static connect(config: Neo4jConfig): Neo4jGraphStore {
    const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password), {
      disableLosslessIntegers: true,
      maxConnectionPoolSize: 20,
    });
    return new Neo4jGraphStore(driver, config.database);
  }

  async verify(): Promise<void> {
    await this.driver.verifyConnectivity({ database: this.database });
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private async read<T>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const { records } = await this.driver.executeQuery(query, params, { database: this.database, routing: neo4j.routing.READ });
    return records.map((r) => r.toObject() as T);
  }

  async migrate(): Promise<void> {
    for (const statement of MIGRATIONS) {
      await this.driver.executeQuery(statement, {}, { database: this.database });
    }
    await this.driver.executeQuery('CALL db.awaitIndexes(120)', {}, { database: this.database });
  }

  async clear(): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.run('MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 1000 ROWS');
    } finally {
      await session.close();
    }
  }

  async writeSnapshot(snapshot: GraphSnapshot): Promise<void> {
    const nodes = snapshot.docs.map((d) => ({
      id: d.node.id,
      label: d.node.label,
      props: {
        ...d.node.props,
        id: d.node.id,
        ref: d.node.id,
        kind: d.node.kind,
        title: d.node.title,
        body: d.node.body,
        status: d.node.status,
        tags: d.node.tags,
        tags_text: d.node.tags.join(' '),
        source_path: d.node.sourcePath,
        created_at: d.node.createdAt,
        content_hash: d.node.contentHash,
      },
    }));
    const review = new Set(snapshot.reviewNeeded.map((r) => `${r.blueprintId}>${r.featureId}`));
    const edges = snapshot.docs.flatMap((d) =>
      d.edges.map((e) => ({ from: e.from, to: e.to, type: e.type, props: e.type === 'ARCHITECTS' ? { review_needed: review.has(`${e.from}>${e.to}`) } : {} })),
    );
    const actors = groupActors(snapshot.docs);

    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite(async (tx: ManagedTransaction) => {
        await tx.run('MATCH (n:Node) WHERE NOT n.id IN $ids DETACH DELETE n', { ids: nodes.map((n) => n.id) });
        await tx.run('MATCH (n) WHERE n:CodeRef OR n:Commit OR n:Actor DETACH DELETE n');
        await tx.run('MATCH (:Node)-[r]->(:Node) DELETE r');
        await tx.run(
          `UNWIND $nodes AS row
           MERGE (n:Node {id: row.id})
           REMOVE n:${NODE_LABELS.join(':')}
           SET n = row.props
           SET n:$(row.label)`,
          { nodes },
        );
        await tx.run(
          `UNWIND $edges AS e
           MATCH (a:Node {id: e.from}), (b:Node {id: e.to})
           MERGE (a)-[r:$(e.type)]->(b)
           SET r += e.props`,
          { edges },
        );
        await tx.run(
          `UNWIND $actors AS a
           MERGE (x:Actor {id: a.id}) SET x.kind = a.kind, x.ref = 'actor:' + a.id, x.title = a.id
           WITH x, a UNWIND a.workOrders AS woId
           MATCH (wo:Node {id: woId}) MERGE (wo)-[:ASSIGNED_TO]->(x)`,
          { actors },
        );
        await tx.run(
          `UNWIND $governed AS g
           MERGE (c:CodeRef {key: g.key})
           SET c.path = g.path, c.symbol = g.symbol, c.hash = g.hash, c.ref = 'code:' + g.key
           WITH c, g MATCH (bp:Node {id: g.blueprintId})
           MERGE (c)-[r:GOVERNED_BY]->(bp) SET r.status = g.status, r.reason = g.reason`,
          { governed: snapshot.governed },
        );
        await tx.run(
          `UNWIND $commits AS c
           MERGE (x:Commit {sha: c.sha})
           SET x.author = c.author, x.date = c.date, x.subject = c.subject, x.refs = c.refs, x.files = c.files, x.ref = 'commit:' + substring(c.sha, 0, 7)
           WITH x, c UNWIND c.refs AS woId
           MATCH (wo:WorkOrder {id: woId}) MERGE (x)-[:RESOLVES]->(wo)`,
          { commits: snapshot.commits },
        );
      });
    } finally {
      await session.close();
    }
  }

  async getNode(id: string): Promise<NodeDetail | null> {
    const rows = await this.read<NodeDetail>(
      `MATCH (n:Node {id: $id})
       RETURN n {.*, label: ${LABEL_OF}} AS node,
         COLLECT { MATCH (n)-[r]->(m) RETURN {type: type(r), direction: 'out', ref: m.ref, title: coalesce(m.title, m.subject, m.key, m.id), props: properties(r)} } +
         COLLECT { MATCH (n)<-[r]-(m) RETURN {type: type(r), direction: 'in', ref: m.ref, title: coalesce(m.title, m.subject, m.key, m.id), props: properties(r)} } AS links`,
      { id },
    );
    return rows[0] ?? null;
  }

  async search(text: string, options: { labels?: NodeLabel[]; limit?: number } = {}): Promise<SearchHit[]> {
    const query = buildLuceneQuery(text);
    if (!query) return [];
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 10), 1), 100);
    return this.read<SearchHit>(
      `CALL db.index.fulltext.queryNodes('node_text', $query, {limit: $fetch}) YIELD node AS n, score
       WITH n, score WHERE size($labels) = 0 OR any(l IN labels(n) WHERE l IN $labels)
       RETURN n.id AS id, ${LABEL_OF} AS label, n.title AS title, n.status AS status, score
       ORDER BY score DESC LIMIT $limit`,
      { query, labels: options.labels ?? [], fetch: neo4j.int(Math.min(limit * 20, 500)), limit: neo4j.int(limit) },
    );
  }

  async branch(id: string): Promise<Subgraph> {
    const rows = await this.read<Subgraph>(
      `MATCH (start:Node {id: $id})
       CALL apoc.path.subgraphAll(start, {relationshipFilter: $up, maxLevel: $depth}) YIELD nodes AS upNodes, relationships AS upRels
       CALL apoc.path.subgraphAll(start, {relationshipFilter: $down, maxLevel: $depth}) YIELD nodes AS downNodes, relationships AS downRels
       WITH apoc.coll.toSet(upNodes + downNodes) AS ns, apoc.coll.toSet(upRels + downRels) AS rs
       ${SUBGRAPH_PROJECTION}`,
      { id, up: UP_FILTER, down: DOWN_FILTER, depth: neo4j.int(MAX_DEPTH) },
    );
    return rows[0] ?? { nodes: [], edges: [] };
  }

  async fullGraph(): Promise<Subgraph> {
    const rows = await this.read<Subgraph>(
      `CALL () { MATCH (n) WHERE n:Node OR n:CodeRef OR n:Commit RETURN collect(n) AS ns }
       CALL () { MATCH (a)-[r:EVOLVES_FROM|ARCHITECTS|IMPLEMENTS|PROVIDES_CONTEXT_FOR|INFORMS|GOVERNED_BY|RESOLVES]->(b) RETURN collect(r) AS rs }
       ${SUBGRAPH_PROJECTION}`,
    );
    return rows[0] ?? { nodes: [], edges: [] };
  }

  async listWorkOrders(filter: { status?: string; blueprint?: string } = {}): Promise<WorkOrderSummary[]> {
    return this.read<WorkOrderSummary>(
      `MATCH (wo:WorkOrder)
       WHERE ($status IS NULL OR wo.status = $status)
         AND ($blueprint IS NULL OR EXISTS { (wo)-[:IMPLEMENTS]->(:Blueprint {id: $blueprint}) })
       RETURN wo.id AS id, wo.title AS title, wo.status AS status, wo.assigned_to AS assignedTo, wo.source_path AS sourcePath,
              COLLECT { MATCH (wo)-[:IMPLEMENTS]->(b:Blueprint) RETURN b.id ORDER BY b.id } AS blueprints
       ORDER BY wo.id`,
      { status: filter.status ?? null, blueprint: filter.blueprint ?? null },
    );
  }

  async workOrderContext(id: string): Promise<WorkOrderContextRaw | null> {
    const rows = await this.read<WorkOrderContextRaw>(
      `MATCH (wo:WorkOrder {id: $id})
       RETURN wo {.*, label: 'WorkOrder'} AS workOrder,
         COLLECT { MATCH (wo)-[:IMPLEMENTS]->(bp:Blueprint) RETURN bp {.*, label: 'Blueprint'} ORDER BY bp.id } AS blueprints,
         COLLECT {
           MATCH (wo)-[:IMPLEMENTS]->(:Blueprint)-[:ARCHITECTS]->(:Feature)(()-[:EVOLVES_FROM]->()){0,${MAX_DEPTH}}(f:Feature)
           WITH DISTINCT f RETURN f {.*, label: 'Feature'} ORDER BY f.id
         } AS features,
         COLLECT {
           MATCH (wo)-[:IMPLEMENTS]->(:Blueprint)-[:ARCHITECTS]->(:Feature)(()-[:EVOLVES_FROM]->()){0,${MAX_DEPTH}}(:Feature)<-[:PROVIDES_CONTEXT_FOR|INFORMS]-(n)
           WITH DISTINCT n RETURN n {.*, label: ${LABEL_OF}} ORDER BY n.id
         } AS context,
         COLLECT {
           MATCH (wo)-[:IMPLEMENTS]->(bp:Blueprint)<-[g:GOVERNED_BY]-(c:CodeRef)
           RETURN {key: c.key, path: c.path, symbol: c.symbol, status: g.status, reason: g.reason, blueprint: bp.id} ORDER BY c.key
         } AS code,
         COLLECT { MATCH (c:Commit)-[:RESOLVES]->(wo) RETURN c {.sha, .subject, .author, .date} ORDER BY c.date DESC } AS commits`,
      { id },
    );
    return rows[0] ?? null;
  }

  async metricsRaw(): Promise<MetricsRaw> {
    const rows = await this.read<MetricsRaw>(
      `CALL () {
         MATCH ()-[g:GOVERNED_BY]->() RETURN count(g) AS governedTotal, sum(CASE WHEN g.status = 'synced' THEN 1 ELSE 0 END) AS governedSynced
       }
       CALL () {
         MATCH (f:Feature)
         RETURN count(f) AS featuresTotal,
                sum(CASE WHEN EXISTS { (f)(()<-[:EVOLVES_FROM]-()){0,${MAX_DEPTH}}(:Feature)<-[:ARCHITECTS]-(:Blueprint)<-[:GOVERNED_BY]-(:CodeRef) } THEN 1 ELSE 0 END) AS featuresTraced
       }
       CALL () {
         MATCH (c:Commit)
         RETURN count(c) AS commitsTotal,
                sum(CASE WHEN size(c.refs) > 0 THEN 1 ELSE 0 END) AS commitsWithRefs,
                sum(CASE WHEN EXISTS { (c)-[:RESOLVES]->(:WorkOrder)-[:IMPLEMENTS]->(:Blueprint)-[:ARCHITECTS]->(:Feature) } THEN 1 ELSE 0 END) AS commitsTraced
       }
       CALL () {
         MATCH (wo:WorkOrder) WITH wo ORDER BY wo.id
         RETURN collect({id: wo.id, status: wo.status, claimedAt: wo.claimed_at, completedAt: wo.completed_at}) AS workOrders
       }
       RETURN governedTotal, governedSynced, featuresTotal, featuresTraced, commitsTotal, commitsWithRefs, commitsTraced, workOrders`,
    );
    const row = rows[0];
    if (!row) throw new Error('metrics query returned no rows');
    return row;
  }
}
