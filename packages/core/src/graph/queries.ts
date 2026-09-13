import { NODE_LABELS } from '../domain/schema.js';

/**
 * Every Cypher string a project-scoped `GraphStore` runs (ADR-002 D1/D2). Each one is parameterized with
 * `$projectId`, so a query can never omit the project filter; `architecture-guard`-style unit tests introspect
 * `SCOPED_QUERIES` to enforce that invariant mechanically instead of relying on review alone.
 */

export const LABEL_OF = `[l IN labels(n) WHERE l <> 'Node'][0]`;
export const UP_FILTER = 'EVOLVES_FROM>|ARCHITECTS>|IMPLEMENTS>|PROVIDES_CONTEXT_FOR>|INFORMS>|JUSTIFIED_BY>';
export const DOWN_FILTER = '<EVOLVES_FROM|<ARCHITECTS|<IMPLEMENTS|<PROVIDES_CONTEXT_FOR|<INFORMS|<JUSTIFIED_BY|<GOVERNED_BY|<RESOLVES';
export const MAX_DEPTH = 25;

const SUBGRAPH_PROJECTION = `
  RETURN [n IN ns | {ref: n.ref, label: ${LABEL_OF}, kind: n.kind, title: coalesce(n.title, n.subject, n.key, n.id), status: n.status}] AS nodes,
         [r IN rs | {from: startNode(r).ref, to: endNode(r).ref, type: type(r), status: r.status, reviewNeeded: coalesce(r.review_needed, false)}] AS edges`;

// -- writeSnapshot -----------------------------------------------------------------------------

export const PROJECT_FINGERPRINT_CHECK = `MATCH (p:Project {id: $projectId}) RETURN p.root_fingerprint AS fingerprint`;

export const PROJECT_UPSERT = `
  MERGE (p:Project {id: $projectId})
  SET p.name = $name, p.updated_at = $updatedAt, p.root_fingerprint = coalesce(p.root_fingerprint, $root)`;

export const DELETE_STALE_NODES = `
  MATCH (n:Node {project_id: $projectId}) WHERE NOT n.id IN $ids DETACH DELETE n`;

export const DELETE_STALE_DERIVED = `
  MATCH (n) WHERE (n:CodeRef OR n:Commit OR n:Actor) AND n.project_id = $projectId DETACH DELETE n`;

export const DELETE_EDGES = `
  MATCH (a:Node {project_id: $projectId})-[r]->(b:Node {project_id: $projectId}) DELETE r`;

export const MERGE_NODES = `
  UNWIND $nodes AS row
  MERGE (n:Node {project_id: $projectId, id: row.id})
  REMOVE n:${NODE_LABELS.join(':')}
  SET n = row.props
  SET n:$(row.label)`;

export const MERGE_EDGES = `
  UNWIND $edges AS e
  MATCH (a:Node {project_id: $projectId, id: e.from}), (b:Node {project_id: $projectId, id: e.to})
  MERGE (a)-[r:$(e.type)]->(b)
  SET r += e.props`;

export const MERGE_ACTORS = `
  UNWIND $actors AS a
  MERGE (x:Actor {project_id: $projectId, id: a.id}) SET x.kind = a.kind, x.ref = 'actor:' + a.id, x.title = a.id
  WITH x, a UNWIND a.workOrders AS woId
  MATCH (wo:Node {project_id: $projectId, id: woId}) MERGE (wo)-[:ASSIGNED_TO]->(x)`;

export const MERGE_GOVERNED = `
  UNWIND $governed AS g
  MERGE (c:CodeRef {project_id: $projectId, key: g.key})
  SET c.path = g.path, c.symbol = g.symbol, c.hash = g.hash, c.ref = 'code:' + g.key
  WITH c, g MATCH (bp:Node {project_id: $projectId, id: g.blueprintId})
  MERGE (c)-[r:GOVERNED_BY]->(bp) SET r.status = g.status, r.reason = g.reason`;

export const MERGE_COMMITS = `
  UNWIND $commits AS c
  MERGE (x:Commit {project_id: $projectId, sha: c.sha})
  SET x.author = c.author, x.date = c.date, x.subject = c.subject, x.refs = c.refs, x.files = c.files, x.ref = 'commit:' + substring(c.sha, 0, 7)
  WITH x, c UNWIND c.refs AS woId
  MATCH (wo:WorkOrder {project_id: $projectId, id: woId}) MERGE (x)-[:RESOLVES]->(wo)`;

export const MERGE_BELONGS_TO = `
  MATCH (p:Project {id: $projectId})
  MATCH (n) WHERE (n:Node OR n:CodeRef OR n:Commit OR n:Actor) AND n.project_id = $projectId
  MERGE (n)-[:BELONGS_TO]->(p)`;

// -- reads --------------------------------------------------------------------------------------

export const GET_NODE = `
  MATCH (n:Node {project_id: $projectId, id: $id})
  RETURN n {.*, label: ${LABEL_OF}} AS node,
    COLLECT { MATCH (n)-[r]->(m) WHERE type(r) <> 'BELONGS_TO' RETURN {type: type(r), direction: 'out', ref: m.ref, title: coalesce(m.title, m.subject, m.key, m.id), props: properties(r)} } +
    COLLECT { MATCH (n)<-[r]-(m) WHERE type(r) <> 'BELONGS_TO' RETURN {type: type(r), direction: 'in', ref: m.ref, title: coalesce(m.title, m.subject, m.key, m.id), props: properties(r)} } AS links`;

export const SEARCH = `
  CALL db.index.fulltext.queryNodes('node_text_v2', $query, {limit: $fetch}) YIELD node AS n, score
  WITH n, score WHERE n.project_id = $projectId AND (size($labels) = 0 OR any(l IN labels(n) WHERE l IN $labels))
  RETURN n.id AS id, ${LABEL_OF} AS label, n.title AS title, n.status AS status, score
  ORDER BY score DESC LIMIT $limit`;

export const BRANCH = `
  MATCH (start:Node {project_id: $projectId, id: $id})
  CALL apoc.path.subgraphAll(start, {relationshipFilter: $up, maxLevel: $depth}) YIELD nodes AS upNodes, relationships AS upRels
  CALL apoc.path.subgraphAll(start, {relationshipFilter: $down, maxLevel: $depth}) YIELD nodes AS downNodes, relationships AS downRels
  WITH apoc.coll.toSet(upNodes + downNodes) AS allNodes, apoc.coll.toSet(upRels + downRels) AS allRels
  WITH [x IN allNodes WHERE x.project_id = $projectId] AS ns,
       [r IN allRels WHERE startNode(r).project_id = $projectId AND endNode(r).project_id = $projectId] AS rs
  ${SUBGRAPH_PROJECTION}`;

export const FULL_GRAPH = `
  CALL () { MATCH (n) WHERE (n:Node OR n:CodeRef OR n:Commit) AND n.project_id = $projectId RETURN collect(n) AS ns }
  CALL () {
    MATCH (a)-[r:EVOLVES_FROM|ARCHITECTS|IMPLEMENTS|PROVIDES_CONTEXT_FOR|INFORMS|JUSTIFIED_BY|GOVERNED_BY|RESOLVES]->(b)
    WHERE a.project_id = $projectId AND b.project_id = $projectId
    RETURN collect(r) AS rs
  }
  ${SUBGRAPH_PROJECTION}`;

export const LIST_WORK_ORDERS = `
  MATCH (wo:WorkOrder {project_id: $projectId})
  WHERE ($status IS NULL OR wo.status = $status)
    AND ($blueprint IS NULL OR EXISTS { (wo)-[:IMPLEMENTS]->(:Blueprint {project_id: $projectId, id: $blueprint}) })
  RETURN wo.id AS id, wo.title AS title, wo.status AS status, wo.assigned_to AS assignedTo, wo.source_path AS sourcePath,
         COLLECT { MATCH (wo)-[:IMPLEMENTS]->(b:Blueprint {project_id: $projectId}) RETURN b.id ORDER BY b.id } AS blueprints
  ORDER BY wo.id`;

export const WORK_ORDER_CONTEXT = `
  MATCH (wo:WorkOrder {project_id: $projectId, id: $id})
  RETURN wo {.*, label: 'WorkOrder'} AS workOrder,
    COLLECT { MATCH (wo)-[:IMPLEMENTS]->(bp:Blueprint {project_id: $projectId}) RETURN bp {.*, label: 'Blueprint'} ORDER BY bp.id } AS blueprints,
    COLLECT {
      MATCH (wo)-[:IMPLEMENTS]->(:Blueprint {project_id: $projectId})-[:ARCHITECTS]->(:Feature {project_id: $projectId})(()-[:EVOLVES_FROM]->()){0,${MAX_DEPTH}}(f:Feature)
      WHERE f.project_id = $projectId
      WITH DISTINCT f RETURN f {.*, label: 'Feature'} ORDER BY f.id
    } AS features,
    COLLECT {
      MATCH (wo)-[:IMPLEMENTS]->(:Blueprint {project_id: $projectId})-[:ARCHITECTS]->(:Feature {project_id: $projectId})(()-[:EVOLVES_FROM]->()){0,${MAX_DEPTH}}(:Feature)<-[:PROVIDES_CONTEXT_FOR|INFORMS]-(n)
      WHERE n.project_id = $projectId
      WITH DISTINCT n RETURN n {.*, label: ${LABEL_OF}} ORDER BY n.id
    } AS context,
    COLLECT {
      MATCH (wo)-[:IMPLEMENTS]->(bp:Blueprint {project_id: $projectId})<-[g:GOVERNED_BY]-(c:CodeRef {project_id: $projectId})
      RETURN {key: c.key, path: c.path, symbol: c.symbol, status: g.status, reason: g.reason, blueprint: bp.id} ORDER BY c.key
    } AS code,
    COLLECT { MATCH (c:Commit {project_id: $projectId})-[:RESOLVES]->(wo) RETURN c {.sha, .subject, .author, .date} ORDER BY c.date DESC } AS commits`;

export const METRICS_RAW = `
  CALL () {
    MATCH ()-[g:GOVERNED_BY]->(bp) WHERE bp.project_id = $projectId
    RETURN count(g) AS governedTotal, sum(CASE WHEN g.status = 'synced' THEN 1 ELSE 0 END) AS governedSynced
  }
  CALL () {
    MATCH (f:Feature {project_id: $projectId})
    RETURN count(f) AS featuresTotal,
           sum(CASE WHEN EXISTS { (f)(()<-[:EVOLVES_FROM]-()){0,${MAX_DEPTH}}(:Feature)<-[:ARCHITECTS]-(:Blueprint)<-[:GOVERNED_BY]-(:CodeRef) } THEN 1 ELSE 0 END) AS featuresTraced
  }
  CALL () {
    MATCH (c:Commit {project_id: $projectId})
    RETURN count(c) AS commitsTotal,
           sum(CASE WHEN size(c.refs) > 0 THEN 1 ELSE 0 END) AS commitsWithRefs,
           sum(CASE WHEN EXISTS { (c)-[:RESOLVES]->(:WorkOrder)-[:IMPLEMENTS]->(:Blueprint)-[:ARCHITECTS]->(:Feature) } THEN 1 ELSE 0 END) AS commitsTraced
  }
  CALL () {
    MATCH (wo:WorkOrder {project_id: $projectId}) WITH wo ORDER BY wo.id
    RETURN collect({id: wo.id, status: wo.status, claimedAt: wo.claimed_at, completedAt: wo.completed_at}) AS workOrders
  }
  RETURN governedTotal, governedSynced, featuresTotal, featuresTraced, commitsTotal, commitsWithRefs, commitsTraced, workOrders`;

export const CLEAR_PROJECT = `
  MATCH (n) WHERE (n:Node OR n:CodeRef OR n:Commit OR n:Actor) AND n.project_id = $projectId
  CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 1000 ROWS`;

/** Every scoped Cypher string above, for the `$projectId` introspection test (see graph/store.ts unit tests). */
export const SCOPED_QUERIES: readonly string[] = [
  PROJECT_FINGERPRINT_CHECK,
  PROJECT_UPSERT,
  DELETE_STALE_NODES,
  DELETE_STALE_DERIVED,
  DELETE_EDGES,
  MERGE_NODES,
  MERGE_EDGES,
  MERGE_ACTORS,
  MERGE_GOVERNED,
  MERGE_COMMITS,
  MERGE_BELONGS_TO,
  GET_NODE,
  SEARCH,
  BRANCH,
  FULL_GRAPH,
  LIST_WORK_ORDERS,
  WORK_ORDER_CONTEXT,
  METRICS_RAW,
  CLEAR_PROJECT,
];
