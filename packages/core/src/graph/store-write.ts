import type { Driver, ManagedTransaction } from 'neo4j-driver';
import type { ProjectRef } from '../project/types.js';
import {
  DELETE_EDGES,
  DELETE_STALE_DERIVED,
  DELETE_STALE_NODES,
  MERGE_ACTORS,
  MERGE_BELONGS_TO,
  MERGE_COMMITS,
  MERGE_EDGES,
  MERGE_GOVERNED,
  MERGE_NODES,
  PROJECT_FINGERPRINT_CHECK,
  PROJECT_UPSERT,
} from './queries.js';
import type { GraphSnapshot } from './types.js';

function groupActors(docs: GraphSnapshot['docs']): { id: string; kind: string; workOrders: string[] }[] {
  const assigned = docs.flatMap((d) => (d.actor ? [{ actor: d.actor, workOrder: d.node.id }] : []));
  const ids = [...new Set(assigned.map((a) => a.actor.id))];
  return ids.map((id) => {
    const entries = assigned.filter((a) => a.actor.id === id);
    return { id, kind: entries[0]?.actor.kind ?? 'developer', workOrders: entries.map((e) => e.workOrder) };
  });
}

/** Fingerprint mismatch (SDD-002 "Proyecto activo", ADR-002 D6): a clone/fork/worktree sharing `project.id` must not silently overwrite another checkout's partition. */
export class ProjectFingerprintMismatch extends Error {
  constructor(projectId: string, boundTo: string) {
    super(`project ${projectId} is bound to ${boundTo}; run \`prdm project claim\` if this checkout should take over`);
  }
}

/** Builds the row shape `MERGE_NODES` expects; `project_id` lives inside `props` so `SET n = row.props` keeps it. */
function buildNodeRows(project: ProjectRef, docs: GraphSnapshot['docs']) {
  return docs.map((d) => ({
    id: d.node.id,
    label: d.node.label,
    props: {
      ...d.node.props,
      id: d.node.id,
      ref: d.node.id,
      project_id: project.id,
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
}

function buildEdgeRows(docs: GraphSnapshot['docs'], reviewNeeded: GraphSnapshot['reviewNeeded']) {
  const review = new Set(reviewNeeded.map((r) => `${r.blueprintId}>${r.featureId}`));
  return docs.flatMap((d) =>
    d.edges.map((e) => ({ from: e.from, to: e.to, type: e.type, props: e.type === 'ARCHITECTS' ? { review_needed: review.has(`${e.from}>${e.to}`) } : {} })),
  );
}

/**
 * Writes one project's snapshot in a single transaction (SDD-002 "Grafo multi-proyecto"): checks/claims the
 * root fingerprint first (throws before any delete on mismatch), then deletes and re-merges only this project's
 * partition, and finally links every Node/CodeRef/Commit/Actor to `(:Project)` via `BELONGS_TO`.
 */
export async function writeSnapshot(driver: Driver, database: string, project: ProjectRef, snapshot: GraphSnapshot): Promise<void> {
  const projectId = project.id;
  const nodes = buildNodeRows(project, snapshot.docs);
  const edges = buildEdgeRows(snapshot.docs, snapshot.reviewNeeded);
  const actors = groupActors(snapshot.docs);

  const session = driver.session({ database });
  try {
    await session.executeWrite(async (tx: ManagedTransaction) => {
      const fp = await tx.run(PROJECT_FINGERPRINT_CHECK, { projectId });
      const existing = fp.records[0]?.get('fingerprint') as string | null | undefined;
      if (existing && existing !== project.root) throw new ProjectFingerprintMismatch(projectId, existing);

      await tx.run(PROJECT_UPSERT, { projectId, name: project.name, root: project.root, updatedAt: new Date().toISOString() });
      await tx.run(DELETE_STALE_NODES, { projectId, ids: nodes.map((n) => n.id) });
      await tx.run(DELETE_STALE_DERIVED, { projectId });
      await tx.run(DELETE_EDGES, { projectId });
      await tx.run(MERGE_NODES, { projectId, nodes });
      await tx.run(MERGE_EDGES, { projectId, edges });
      await tx.run(MERGE_ACTORS, { projectId, actors });
      await tx.run(MERGE_GOVERNED, { projectId, governed: snapshot.governed });
      await tx.run(MERGE_COMMITS, { projectId, commits: snapshot.commits });
      await tx.run(MERGE_BELONGS_TO, { projectId });
    });
  } finally {
    await session.close();
  }
}
