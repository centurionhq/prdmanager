import { ACTOR_PATTERN, ID_PATTERN, SHA_PATTERN, type ParsedDoc } from '../domain/schema.js';
import type { Engine } from '../engine.js';
import { readCommit } from '../sync/git.js';
import type { DriftIssue } from '../sync/monitor.js';

type WorkOrderDoc = ParsedDoc & { frontmatter: Extract<ParsedDoc['frontmatter'], { type: 'WO' }> };

function findWorkOrder(docs: ParsedDoc[], id: string): WorkOrderDoc {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid work order id: ${id}`);
  const doc = docs.find((d) => d.node.id === id);
  if (!doc) throw new Error(`work order ${id} not found`);
  if (doc.frontmatter.type !== 'WO') throw new Error(`${id} is not a work order`);
  return doc as WorkOrderDoc;
}

export interface ClaimResult {
  id: string;
  status: 'in_progress';
  assignedTo: string;
  claimedAt: string;
}

/** Claims a todo/out_of_sync work order for an actor, moving it to in_progress. */
export async function claimWorkOrder(engine: Engine, id: string, assignee: string, now: Date = new Date()): Promise<ClaimResult> {
  if (!ACTOR_PATTERN.test(assignee)) throw new Error(`invalid assignee: ${assignee} (expected agent:name or dev:name)`);

  return engine.transaction(async (ops) => {
    const { docs } = await ops.scan();
    const doc = findWorkOrder(docs, id);
    if (doc.frontmatter.status !== 'todo' && doc.frontmatter.status !== 'out_of_sync') {
      throw new Error(`cannot claim ${id}: status is ${doc.frontmatter.status}, expected todo or out_of_sync`);
    }

    const claimedAt = now.toISOString();
    await ops.updateDocument(id, { status: 'in_progress', assigned_to: assignee, claimed_at: claimedAt });
    await ops.refresh();
    return { id, status: 'in_progress', assignedTo: assignee, claimedAt };
  });
}

async function verifyResolvingCommit(root: string, id: string, sha: string): Promise<string> {
  const commit = await readCommit(root, sha);
  if (!commit) throw new Error(`commit ${sha} was not found in the repository`);
  if (!commit.refs.includes(id)) throw new Error(`commit ${sha} does not reference ${id}; add the trailer "Refs: ${id}" to its message`);
  return commit.sha;
}

export interface CompleteOptions {
  commitSha?: string;
  now?: Date;
}

export interface CompleteResult {
  id: string;
  status: 'done';
  completedAt: string;
  resolvedBy: string[];
  drift: DriftIssue[];
}

/** Completes an in_progress/out_of_sync work order, recording the current content hash of every blueprint it implements. */
export async function completeWorkOrder(engine: Engine, id: string, options: CompleteOptions = {}): Promise<CompleteResult> {
  const { commitSha, now = new Date() } = options;
  if (commitSha !== undefined && !SHA_PATTERN.test(commitSha)) throw new Error(`invalid commit sha: ${commitSha}`);

  return engine.transaction(async (ops) => {
    const { docs } = await ops.scan();
    const doc = findWorkOrder(docs, id);
    if (doc.frontmatter.status !== 'in_progress' && doc.frontmatter.status !== 'out_of_sync') {
      throw new Error(`cannot complete ${id}: status is ${doc.frontmatter.status}, expected in_progress or out_of_sync`);
    }

    const resolvingSha = commitSha ? await verifyResolvingCommit(ops.config.root, id, commitSha) : null;
    const completedAt = now.toISOString();
    const resolvedBy = resolvingSha ? [...new Set([...doc.frontmatter.resolved_by, resolvingSha])] : doc.frontmatter.resolved_by;
    const blueprintHashes = Object.fromEntries(
      doc.frontmatter.implements.map((bpId) => {
        const blueprint = docs.find((d) => d.node.id === bpId);
        if (!blueprint) throw new Error(`work order ${id} implements missing blueprint ${bpId}`);
        return [bpId, blueprint.node.contentHash];
      }),
    );

    await ops.updateDocument(id, { status: 'done', completed_at: completedAt, resolved_by: resolvedBy, blueprint_hashes: blueprintHashes });
    const report = await ops.refresh();

    const scope = new Set([id, ...doc.frontmatter.implements]);
    const drift = report.issues.filter((issue) => scope.has(issue.nodeId));
    return { id, status: 'done', completedAt, resolvedBy, drift };
  });
}
