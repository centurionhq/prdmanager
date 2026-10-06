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
  WITH wo,
       COLLECT { MATCH (c:Commit {project_id: $projectId})-[:RESOLVES]->(wo)
                 RETURN c.sha AS sha ORDER BY c.date DESC, c.sha DESC LIMIT 1 } AS landed
  RETURN wo.id AS id, wo.title AS title, wo.status AS status, wo.assigned_to AS assignedTo, wo.source_path AS sourcePath,
         wo.created_at AS createdAt, wo.claimed_at AS claimedAt, landed[0] AS landedCommitSha, wo.deliverable_kind AS deliverableKind,
         COLLECT { MATCH (wo)-[:IMPLEMENTS]->(b:Blueprint {project_id: $projectId}) RETURN b.id ORDER BY b.id } AS blueprints
  ORDER BY wo.id`;

/**
 * Filtros compartidos por los tres CALL de `QUERY_WORK_ORDERS` (blueprint/actor/assignedTo/q), parametrizados por el alias
 * de la WO. `$q` llega ya en minúsculas; el estado NO está acá porque `statusCounts` se calcula sin él (D5).
 */
const woBaseFilter = (a: string): string => `
    ($blueprint IS NULL OR EXISTS { (${a})-[:IMPLEMENTS]->(:Blueprint {project_id: $projectId, id: $blueprint}) })
    AND ($assignedTo IS NULL OR ${a}.assigned_to = $assignedTo)
    AND ($actorKind IS NULL
         OR ($actorKind = 'unassigned' AND (${a}.assigned_to IS NULL OR ${a}.assigned_to = ''))
         OR ($actorKind = 'agent' AND ${a}.assigned_to STARTS WITH 'agent:')
         OR ($actorKind = 'dev' AND ${a}.assigned_to STARTS WITH 'dev:'))
    AND ($q IS NULL
         OR toLower(${a}.id) CONTAINS $q
         OR toLower(coalesce(${a}.title, '')) CONTAINS $q
         OR toLower(coalesce(${a}.assigned_to, '')) CONTAINS $q
         OR EXISTS { MATCH (${a})-[:IMPLEMENTS]->(b:Blueprint {project_id: $projectId}) WHERE toLower(b.id) CONTAINS $q })`;

/**
 * Vista paginada de WOs (SDD-064 D1..D8): `LIST_WORK_ORDERS` queda intacto. Los tres `CALL` devuelven siempre una fila
 * (collect/count/sum agregan incluso sobre vacío). Sin `$status` se excluyen las archivadas (D3); `statusCounts` ignora el estado.
 */
export const QUERY_WORK_ORDERS = `
  CALL () {
    MATCH (wo:WorkOrder {project_id: $projectId})
    WHERE ${woBaseFilter('wo')}
      AND (($status IS NULL AND wo.status <> 'archived') OR wo.status = $status)
    WITH wo ORDER BY wo.id SKIP $offset LIMIT $limit
    OPTIONAL MATCH (wo)-[:IMPLEMENTS]->(bp:Blueprint {project_id: $projectId})
    WITH wo, collect(bp.id) AS blueprints
    ORDER BY wo.id
    RETURN collect({id: wo.id, title: wo.title, status: wo.status, assignedTo: wo.assigned_to, sourcePath: wo.source_path,
                    deliverableKind: wo.deliverable_kind,
                    blueprints: [x IN blueprints WHERE x IS NOT NULL]}) AS items
  }
  CALL () {
    MATCH (w2:WorkOrder {project_id: $projectId})
    WHERE ${woBaseFilter('w2')}
      AND (($status IS NULL AND w2.status <> 'archived') OR w2.status = $status)
    RETURN count(w2) AS total
  }
  CALL () {
    MATCH (w3:WorkOrder {project_id: $projectId})
    WHERE ${woBaseFilter('w3')}
    RETURN sum(CASE WHEN w3.status <> 'archived' THEN 1 ELSE 0 END) AS all,
           sum(CASE WHEN w3.status = 'pending' THEN 1 ELSE 0 END) AS pending,
           sum(CASE WHEN w3.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           sum(CASE WHEN w3.status = 'out_of_sync' THEN 1 ELSE 0 END) AS out_of_sync,
           sum(CASE WHEN w3.status = 'done' THEN 1 ELSE 0 END) AS done,
           sum(CASE WHEN w3.status = 'archived' THEN 1 ELSE 0 END) AS archived
  }
  RETURN items, total,
         {all: all, pending: pending, in_progress: in_progress, out_of_sync: out_of_sync, done: done, archived: archived} AS statusCounts`;

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
    WITH f ORDER BY f.id
    WITH f, EXISTS { (f)((:Feature)-[:EVOLVES_FROM|JUSTIFIED_BY]-(:Feature)){0,${MAX_DEPTH}}(:Feature)<-[:ARCHITECTS]-(:Blueprint {project_id: $projectId})<-[:GOVERNED_BY]-(:CodeRef {project_id: $projectId}) } AS traced
    RETURN count(f) AS featuresTotal,
           sum(CASE WHEN traced THEN 1 ELSE 0 END) AS featuresTraced,
           collect(CASE WHEN traced THEN null ELSE {id: f.id, kind: f.kind, title: coalesce(f.title, f.id), status: coalesce(f.status, '')} END) AS orphanFeatures
  }
  CALL () {
    MATCH (c:Commit {project_id: $projectId})
    RETURN count(c) AS commitsTotal,
           sum(CASE WHEN size(c.refs) > 0 THEN 1 ELSE 0 END) AS commitsWithRefs,
           sum(CASE WHEN EXISTS { (c)-[:RESOLVES]->(:WorkOrder)-[:IMPLEMENTS]->(:Blueprint)-[:ARCHITECTS]->(:Feature) } THEN 1 ELSE 0 END) AS commitsTraced
  }
  CALL () {
    MATCH (wo:WorkOrder {project_id: $projectId}) WITH wo ORDER BY wo.id
    RETURN collect({id: wo.id, status: wo.status, assignedTo: wo.assigned_to, createdAt: wo.created_at, claimedAt: wo.claimed_at, completedAt: wo.completed_at}) AS workOrders
  }
  RETURN governedTotal, governedSynced, featuresTotal, featuresTraced, orphanFeatures, commitsTotal, commitsWithRefs, commitsTraced, workOrders`;

/**
 * Commits sin trazar (SDD-080 WO-A): los que NO cierran `RESOLVES→WorkOrder→IMPLEMENTS→Blueprint→ARCHITECTS→Feature`.
 * El predicado es el mismo, carácter por carácter, que `commitsTraced` en METRICS_RAW, así que
 * `total == commitsTotal - commitsTraced` y `danglingRefs == commitsWithRefs - commitsTraced` valen por construcción.
 * `total`/`danglingRefs` salen de la agregación (exactos); `items` va capado por `$limit`. Si no hay commits sin trazar
 * el subquery no devuelve filas y la consulta entera devuelve 0 filas (el lector lo mapea al caso vacío).
 */
export const UNTRACED_COMMITS = `
  MATCH (c:Commit {project_id: $projectId})
  WITH c, size(c.refs) > 0 AS hasRefs
  WHERE NOT EXISTS { (c)-[:RESOLVES]->(:WorkOrder)-[:IMPLEMENTS]->(:Blueprint)-[:ARCHITECTS]->(:Feature) }
  WITH count(*) AS total, coalesce(sum(CASE WHEN hasRefs THEN 1 ELSE 0 END), 0) AS danglingRefs
  CALL () {
    MATCH (c:Commit {project_id: $projectId})
    WITH c, size(c.refs) > 0 AS hasRefs
    WHERE NOT EXISTS { (c)-[:RESOLVES]->(:WorkOrder)-[:IMPLEMENTS]->(:Blueprint)-[:ARCHITECTS]->(:Feature) }
    RETURN {sha: c.sha, subject: coalesce(c.subject, ''), author: coalesce(c.author, ''), date: coalesce(c.date, ''), files: coalesce(c.files, []), gap: CASE WHEN hasRefs THEN 'dangling_refs' ELSE 'no_refs' END} AS item
    ORDER BY c.date DESC, c.sha ASC
    LIMIT $limit
  }
  RETURN total, danglingRefs, collect(item) AS items`;

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
  QUERY_WORK_ORDERS,
  WORK_ORDER_CONTEXT,
  METRICS_RAW,
  UNTRACED_COMMITS,
  CLEAR_PROJECT,
];
