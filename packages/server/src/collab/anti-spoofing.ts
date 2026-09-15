/**
 * `beforeSync` anti-spoofing check for `/collab` (SDD-008 §"Autoría por línea no falsificable", WO-150)
 * — the security-critical hook of this batch. Must run *before* `./attribution.js`'s own `beforeSync`
 * in the `Hocuspocus` extensions array (`register-collab-route.js` enforces the order): a rejected
 * update must never be durably logged as if it were legitimate.
 *
 * Throwing from `beforeSync` is what actually rejects the update: `readSyncMessage` `await`s this hook
 * *before* the switch that applies SyncStep2/Update, so a thrown error here means `Y.applyUpdate` never
 * runs at all — and `Connection.processMessages`'s own `catch` block (confirmed against the installed
 * `@hocuspocus/server` 4.7.0 source) closes the connection itself once any hook throws, with no extra
 * `connection.close()` call needed here. The client's own provider then reconnects with a brand-new
 * `Y.Doc`/client id, per SDD-008's own note on this exact recovery path.
 *
 * Skips (never checks, never throws) for `SyncStep1` (a bare state-vector exchange, no update bytes)
 * and for a read-only connection's attempted edit — same reasoning as `./attribution.js`: Hocuspocus
 * drops that message *after* `beforeSync` returns without ever applying it, so flagging it as spoofing
 * would be a false positive against a connection that was never going to change anything anyway.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import { checkUpdateAgainstBindings, decodeUpdateRanges } from '@prdm/collab';
import { assertNoSecretsInAuditMetadata, createTenantDb, schema, withTenantTx } from '@prdm/db';
import type { CollabDocumentContext } from './authenticate.js';

const SYNC_STEP_1 = 0;

export interface CollabAntiSpoofingDocumentLike {
  gc: boolean;
}

export interface CollabAntiSpoofingConnectionLike {
  readOnly: boolean;
}

export interface CollabAntiSpoofingPayload {
  type: number;
  payload: Uint8Array;
  document: Parameters<typeof Y.encodeStateVector>[0];
  context: Partial<CollabDocumentContext>;
  connection: CollabAntiSpoofingConnectionLike;
}

export interface CollabAntiSpoofingExtension {
  extensionName: string;
  beforeSync(data: CollabAntiSpoofingPayload): Promise<void>;
}

export interface CollabAntiSpoofingDeps {
  pool: Pool;
}

/** Every currently-bound `client_id -> user_id` for the given clients on this document, scoped to the
 * tenant (RLS). `client_id` is stored as `text` (see `doc-client-bindings.ts`'s own note on why), keyed
 * back to the numeric Yjs client id the caller already has. */
async function loadClientBindings(pool: Pool, orgId: string, documentId: string, clientIds: readonly number[]): Promise<Map<number, string>> {
  if (clientIds.length === 0) return new Map();
  const clientIdStrings = clientIds.map(String);
  return withTenantTx(pool, orgId, async (tx) => {
    const rows = await tx
      .select({ clientId: schema.docClientBindings.clientId, userId: schema.docClientBindings.userId })
      .from(schema.docClientBindings)
      .where(and(eq(schema.docClientBindings.documentId, documentId), inArray(schema.docClientBindings.clientId, clientIdStrings)));
    return new Map(rows.map((row) => [Number(row.clientId), row.userId]));
  });
}

async function auditRejection(pool: Pool, params: { orgId: string; projectId: string; documentId: string; userId: string; reason: string }): Promise<void> {
  const metadata = { reason: params.reason };
  assertNoSecretsInAuditMetadata(metadata);
  await createTenantDb(pool)
    .forOrg(params.orgId)
    .auditLog.record({
      projectId: params.projectId,
      actorType: 'user',
      actorId: params.userId,
      action: 'collab.update_rejected_spoofing',
      target: params.documentId,
      metadata,
    });
}

export function createCollabAntiSpoofingExtension(deps: CollabAntiSpoofingDeps): CollabAntiSpoofingExtension {
  const { pool } = deps;

  return {
    extensionName: 'prdm-collab-anti-spoofing',

    async beforeSync(data) {
      if (data.type === SYNC_STEP_1) return;
      if (data.connection.readOnly) return;

      const { orgId, projectId, documentId, userId } = data.context;
      if (!orgId || !projectId || !documentId || !userId) {
        throw new Error('missing collab context for anti-spoofing check');
      }

      const { structRanges, deleteRanges } = decodeUpdateRanges(data.payload);
      const serverStateVector = Y.decodeStateVector(Y.encodeStateVector(data.document));
      const clientIds = structRanges.map((range) => range.client);
      const bindings = await loadClientBindings(pool, orgId, documentId, clientIds);

      const result = checkUpdateAgainstBindings({
        structRanges,
        deleteRanges,
        serverStateVector,
        lookupBinding: (client) => bindings.get(client),
        connectionUserId: userId,
      });

      if (!result.ok) {
        const reason = result.reason ?? 'rejected by anti-spoofing check';
        await auditRejection(pool, { orgId, projectId, documentId, userId, reason });
        throw new Error(reason);
      }
    },
  };
}
