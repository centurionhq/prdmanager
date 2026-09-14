/**
 * Accepting an `agent_proposals` row (SDD-009 §Diseño: "Aceptar (editor+): re-resuelve las anclas y
 * re-valida campos; si el texto ya no coincide, la propuesta pasa a stale ... Si coincide, aplica todo en
 * una transacción de servidor de SDD-008 con actor {agent_id: 'agent:deepseek', on_behalf_of: <quien
 * acepta>, requested_by: <quien pidió>, proposal_id}, crea versión agent_accept y audita"; WO-174).
 *
 * Reuses `../collab/restore.ts`'s exact "direct connection + scratch doc with a fresh client id, diffed
 * against the live document's current state vector, written durably *before* the live document ever
 * changes" pattern (its own module doc comment explains why a direct connection needs to do this itself —
 * there is no `beforeSync` hook to gate on) — the only difference is *what* gets applied to the scratch
 * doc: here, each edit's replacement text at its anchor's *current* resolved position (never the
 * original, possibly-now-stale, character offsets — the whole reason `propose_edit`, WO-173, anchored with
 * `Y.RelativePosition` in the first place) plus any `fields.set`/`fields.unset`, rather than a version
 * snapshot's full projection.
 *
 * Staleness (SDD-009): re-resolves every edit's anchor against the *live* document right before applying —
 * if any anchor no longer resolves, or resolves to text that no longer matches `expectedText` exactly (a
 * concurrent edit touched it since the proposal was created), the whole proposal is rejected as `stale`
 * and nothing is applied — never a partial application of only the edits that still happen to match.
 * Frontmatter forbidden-field checks are re-run too, against the document's *current* fields, for the same
 * reason (a field could have become lifecycle-managed since the proposal was created).
 *
 * WO-228 (security review #3, HIGH): the document's own forced-read-only freeze (archived, or `origin:
 * 'generated'` — the exact same `isDocumentForcedReadOnly` predicate `authorizeCollabDocument` uses for
 * human live editing, and `propose_edit`, WO-228, uses at creation time) is re-checked here too, at both
 * points `findStaleReason` runs — a document that became archived/generated *after* the proposal was
 * created but before it's accepted is treated exactly like a stale proposal: marked stale, never applied.
 *
 * Applied in descending start-offset order within the scratch transaction so an earlier (in the array,
 * later in the text) edit's delete+insert never shifts the still-to-be-applied absolute offsets of an
 * edit earlier in the text — resolving every anchor's absolute position *before* mutating anything, then
 * applying back-to-front, is what makes this safe without needing to re-resolve between each edit.
 */
import { desc, eq, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import type { Pool } from 'pg';
import {
  BODY_ROOT,
  createDocumentYDoc,
  decodeUpdateRanges,
  FRONTMATTER_ROOT,
  resolveCommentAnchor,
  type EncodedCommentAnchor,
  type FrontmatterValue,
} from '@prdm/collab';
import { forbiddenFieldInjectionIssues, type FieldValue } from '@prdm/core';
import { createTenantDb, schema, withTenantTx, type AgentProposalRecord, type DocumentVersionRecord } from '@prdm/db';
import type { ResolvedProposalEdit } from '../agent/tools/propose-edit.js';
import { isDocumentForcedReadOnly, type ForcedReadOnlyDocumentFields } from './authorize-document.js';
import { formatDocumentName } from './document-name.js';
import { reconstructLiveYDoc } from './reconstruct-ydoc.js';
import { captureDocumentVersion } from './versions.js';

export const AGENT_ACTOR_ID = 'agent:deepseek';

const DOC_UPDATES_LOCK_SALT = 0x5044_5530; // 'PDU0' — same salt/keyspace as ./doc-update-writer.js and ./restore.js.

function freshClientId(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export class ProposalNotFoundError extends Error {}
export class ProposalNotPendingError extends Error {}

export type AcceptAgentProposalResult = { status: 'accepted'; version: DocumentVersionRecord | null } | { status: 'stale' };

export interface AcceptAgentProposalInput {
  orgId: string;
  projectId: string;
  documentId: string;
  proposalId: string;
  acceptingUserId: string;
}

function toAnchor(startBase64: string, endBase64: string): EncodedCommentAnchor {
  return { start: Buffer.from(startBase64, 'base64'), end: Buffer.from(endBase64, 'base64') };
}

/** WO-228: fetches just the two fields `isDocumentForcedReadOnly` needs, straight from the committed
 * `documents` row (never derived from the Y.Doc — `origin`/`workflow_state` live in Postgres, not in the
 * collaborative document itself) — `null` if the document row can't be found (an edge case outside this
 * WO's scope; callers treat that the same as "not forced read-only" and let the rest of staleness
 * validation run as before). Called twice, same as every other part of `findStaleReason`. */
async function loadDocumentReadOnlyFlags(pool: Pool, orgId: string, documentId: string): Promise<ForcedReadOnlyDocumentFields | null> {
  return withTenantTx(pool, orgId, async (tx) => {
    const [row] = await tx.select({ origin: schema.documents.origin, workflowState: schema.documents.workflowState }).from(schema.documents).where(eq(schema.documents.id, documentId));
    return row ?? null;
  });
}

/** `null` (never throws) when re-validation finds nothing wrong — the one shared check between the
 * "should we mark stale" decision and the final safety net right before writing. */
function findStaleReason(
  edits: readonly ResolvedProposalEdit[],
  currentFields: Record<string, FrontmatterValue>,
  proposal: AgentProposalRecord,
  liveDoc: Y.Doc,
  documentFlags: ForcedReadOnlyDocumentFields | null,
): string | null {
  if (documentFlags && isDocumentForcedReadOnly(documentFlags)) {
    return 'the document is now archived or generated and can no longer accept agent proposals';
  }

  for (const edit of edits) {
    const { quotedText } = resolveCommentAnchor(liveDoc, toAnchor(edit.anchorStart, edit.anchorEnd));
    if (quotedText !== edit.expectedText) return `anchor for ${JSON.stringify(edit.expectedText)} no longer matches the current document`;
  }

  if (proposal.fieldsSet || proposal.fieldsUnset) {
    const rendered: Record<string, FieldValue> = { ...(currentFields as Record<string, FieldValue>) };
    for (const [key, value] of Object.entries((proposal.fieldsSet as Record<string, string> | null) ?? {})) rendered[key] = value;
    for (const key of (proposal.fieldsUnset as string[] | null) ?? []) delete rendered[key];
    const issues = forbiddenFieldInjectionIssues(rendered, currentFields as Record<string, FieldValue>);
    if (issues.length > 0) return issues.map((issue) => issue.message).join('; ');
  }

  return null;
}

export async function acceptAgentProposal(pool: Pool, hocuspocus: Hocuspocus, input: AcceptAgentProposalInput): Promise<AcceptAgentProposalResult> {
  const { orgId, projectId, documentId, proposalId, acceptingUserId } = input;
  const tenantDb = createTenantDb(pool).forOrg(orgId);

  const proposal = await tenantDb.agent.proposals.findById(proposalId);
  if (!proposal || proposal.documentId !== documentId) throw new ProposalNotFoundError();
  if (proposal.status !== 'pending') throw new ProposalNotPendingError();

  const edits = proposal.edits as ResolvedProposalEdit[];
  const { ydoc: liveDocSnapshot } = await reconstructLiveYDoc(pool, orgId, documentId);
  const currentFields: Record<string, FrontmatterValue> = {};
  liveDocSnapshot.getMap<FrontmatterValue>(FRONTMATTER_ROOT).forEach((value, key) => {
    currentFields[key] = value;
  });

  const documentFlags = await loadDocumentReadOnlyFlags(pool, orgId, documentId);
  if (findStaleReason(edits, currentFields, proposal, liveDocSnapshot, documentFlags) !== null) {
    await tenantDb.agent.proposals.markStale(proposalId);
    return { status: 'stale' };
  }

  // Atomic claim (WO-174, concurrency hardening): flips pending -> accepted right here, before any Y.Doc
  // mutation, so two simultaneous accept requests for the same proposal (e.g. a UI double-click) can never
  // both reach the write below — `markAccepted`'s own `WHERE status = 'pending'` guard means only one of
  // them gets a non-null row back; the loser throws immediately without ever touching the document.
  const claimed = await tenantDb.agent.proposals.markAccepted(proposalId, acceptingUserId);
  if (!claimed) throw new ProposalNotPendingError();

  const documentName = formatDocumentName(projectId, documentId);
  const direct = await hocuspocus.openDirectConnection(documentName, {});
  try {
    const liveDocument = direct.document;
    if (!liveDocument) throw new Error(`direct connection to ${documentName} has no document`);

    const clientId = freshClientId();
    const before = Y.encodeStateVector(liveDocument);
    const scratch = createDocumentYDoc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(liveDocument));
    scratch.clientID = clientId;

    // Last-instant re-check against the scratch clone of the *actual* live document (rather than the
    // slightly-earlier `liveDocSnapshot` reconstruction above) — closes the narrow window between that
    // reconstruction and opening this direct connection.
    const lastInstantFields: Record<string, FrontmatterValue> = {};
    scratch.getMap<FrontmatterValue>(FRONTMATTER_ROOT).forEach((value, key) => {
      lastInstantFields[key] = value;
    });
    const lastInstantDocumentFlags = await loadDocumentReadOnlyFlags(pool, orgId, documentId);
    const staleReason = findStaleReason(edits, lastInstantFields, proposal, scratch, lastInstantDocumentFlags);
    if (staleReason !== null) {
      scratch.destroy();
      // Already claimed above — revert rather than markStale (which would no-op: status is no longer
      // 'pending'). Safe unconditionally: this call is only ever reached by whichever request just won
      // the claim above, so nothing else can be concurrently deciding this same proposal's fate.
      await tenantDb.agent.proposals.forceStale(proposalId);
      return { status: 'stale' };
    }

    const resolvedRanges = edits.map((edit) => {
      const relStart = Y.decodeRelativePosition(toAnchor(edit.anchorStart, edit.anchorEnd).start);
      const relEnd = Y.decodeRelativePosition(toAnchor(edit.anchorStart, edit.anchorEnd).end);
      const absStart = Y.createAbsolutePositionFromRelativePosition(relStart, scratch);
      const absEnd = Y.createAbsolutePositionFromRelativePosition(relEnd, scratch);
      if (!absStart || !absEnd) throw new Error('anchor unexpectedly failed to resolve after passing staleness checks');
      return { edit, from: absStart.index, to: absEnd.index };
    });
    // Back-to-front: an edit's delete+insert only ever shifts offsets *after* it, never before.
    resolvedRanges.sort((a, b) => b.from - a.from);

    scratch.transact(() => {
      const body = scratch.getText(BODY_ROOT);
      for (const { edit, from, to } of resolvedRanges) {
        body.delete(from, to - from);
        body.insert(from, edit.replacement);
      }
      if (proposal.fieldsSet || proposal.fieldsUnset) {
        const fm = scratch.getMap<FrontmatterValue>(FRONTMATTER_ROOT);
        for (const [key, value] of Object.entries((proposal.fieldsSet as Record<string, string> | null) ?? {})) fm.set(key, value);
        for (const key of (proposal.fieldsUnset as string[] | null) ?? []) fm.delete(key);
      }
    }, AGENT_ACTOR_ID);

    const update = Y.encodeStateAsUpdate(scratch, before);
    scratch.destroy();

    if (update.length > 0) {
      const { structRanges, deleteRanges } = decodeUpdateRanges(update);
      await withTenantTx(pool, orgId, async (tx) => {
        await tx.execute(withAdvisoryLockSql(documentId));
        const [latest] = await tx.select({ seq: schema.docUpdates.seq }).from(schema.docUpdates).where(eq(schema.docUpdates.documentId, documentId)).orderBy(desc(schema.docUpdates.seq)).limit(1);
        const seq = (latest?.seq ?? 0) + 1;

        await tx.insert(schema.docUpdates).values({
          orgId,
          documentId,
          seq,
          actorKind: 'agent',
          userId: null,
          onBehalfOf: acceptingUserId,
          agentId: AGENT_ACTOR_ID,
          connectionId: null,
          update: Buffer.from(update),
          structRanges,
          deleteRanges,
        });
        // No doc_client_bindings row (mirrors ./doc-update-writer.js's own note): bindings only ever bind a
        // *user's* client id to look up who's typing live — an agent-attributed server transaction is
        // never itself a live connection.
      });

      await direct.transact((doc) => Y.applyUpdate(doc, update, AGENT_ACTOR_ID));
    }
  } finally {
    await direct.disconnect();
  }

  const version = await captureDocumentVersion(pool, orgId, { documentId, reason: 'agent_accept', createdBy: acceptingUserId });

  return { status: 'accepted', version };
}

// Kept as a tiny helper (rather than inlined `sql` template) only so the lock's own reasoning — matching
// ./doc-update-writer.js's exact salt/keyspace — reads as one sentence at the call site above.
function withAdvisoryLockSql(documentId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${documentId}::text, ${DOC_UPDATES_LOCK_SALT}))`;
}
