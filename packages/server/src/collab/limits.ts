/**
 * Numeric limits for `/collab` (SDD-008 §"Servidor de tiempo real", WO-152): rendered doc size, encoded
 * Yjs state size, connections per user/document, and update rate per user/document. Exceeding any of
 * them closes the offending connection and audits it (except the encoded-state cap, which SDD-008
 * describes as making the document permanently read-only with a notice rather than closing anyone —
 * "el escape es archivarlo y crear uno nuevo desde su última versión").
 *
 * Connection-count limits are checked in `connected` (the first hook whose payload carries both the
 * live `Connection` and the `Hocuspocus` `instance` needed to count existing connections) — the
 * newly-established connection is closed immediately if it would put either count over the limit,
 * matching WO-148's own use of `connected` for the same reason (it's the first point a `Connection`
 * object exists to close).
 *
 * Size and rate limits are checked in `beforeSync`, ordered *before* `./anti-spoofing.js`/
 * `./attribution.js` in the extensions array (`register-collab-route.js`) so an update that's already
 * going to be rejected for exceeding a limit never reaches the (more expensive) anti-spoofing DB lookup
 * or gets durably logged.
 */
import * as Y from 'yjs';
import type { Pool } from 'pg';
import { BODY_ROOT } from '@prdm/collab';
import { assertNoSecretsInAuditMetadata, createTenantDb } from '@prdm/db';
import type { CollabDocumentContext } from './authenticate.js';
import { createRateWindowCounter } from './rate-window.js';

const SYNC_STEP_1 = 0;

export interface CollabLimits {
  maxRenderedBytes: number;
  maxEncodedStateBytes: number;
  maxConnectionsPerUser: number;
  maxConnectionsPerDocument: number;
  maxUpdatesPerSecPerUser: number;
  maxUpdatesPerSecPerDocument: number;
}

export interface CollabLimitsConnectionLike {
  readOnly: boolean;
  close(): void;
  context: Partial<CollabDocumentContext>;
}

export interface CollabLimitsDocumentLike {
  getConnectionsCount(): number;
  connections: Map<CollabLimitsConnectionLike, unknown>;
  getText(name: string): { length: number };
}

export interface CollabLimitsInstanceLike {
  documents: Map<string, CollabLimitsDocumentLike>;
}

export interface CollabConnectedPayload {
  documentName: string;
  instance: CollabLimitsInstanceLike;
  connection: CollabLimitsConnectionLike;
}

export interface CollabLimitsBeforeSyncPayload {
  type: number;
  document: Y.Doc;
  context: Partial<CollabDocumentContext>;
  connection: CollabLimitsConnectionLike;
}

export interface CollabLimitsExtension {
  extensionName: string;
  connected(data: CollabConnectedPayload): Promise<void>;
  beforeSync(data: CollabLimitsBeforeSyncPayload): Promise<void>;
}

export interface CollabLimitsDeps {
  pool: Pool;
  clock: () => Date;
  limits: CollabLimits;
}

async function auditLimitEvent(pool: Pool, params: { orgId: string; projectId: string; documentId: string; userId: string; action: string; reason: string }): Promise<void> {
  const metadata = { reason: params.reason };
  assertNoSecretsInAuditMetadata(metadata);
  await createTenantDb(pool)
    .forOrg(params.orgId)
    .auditLog.record({
      projectId: params.projectId,
      actorType: 'user',
      actorId: params.userId,
      action: params.action,
      target: params.documentId,
      metadata,
    })
    .catch(() => undefined);
}

function countConnectionsForUser(instance: CollabLimitsInstanceLike, userId: string): number {
  let count = 0;
  instance.documents.forEach((document) => {
    document.connections.forEach((_meta, connection) => {
      if (connection.context.userId === userId) count += 1;
    });
  });
  return count;
}

export function createCollabLimitsExtension(deps: CollabLimitsDeps): CollabLimitsExtension {
  const { pool, clock, limits } = deps;
  const updateRate = createRateWindowCounter(clock);

  return {
    extensionName: 'prdm-collab-limits',

    async connected(data) {
      const { userId, orgId, projectId, documentId } = data.connection.context;
      if (!userId || !orgId || !projectId || !documentId) return;

      const document = data.instance.documents.get(data.documentName);
      const perDocumentCount = document?.getConnectionsCount() ?? 0;
      if (perDocumentCount > limits.maxConnectionsPerDocument) {
        await auditLimitEvent(pool, { orgId, projectId, documentId, userId, action: 'collab.limit_connections_per_document', reason: `${perDocumentCount} > ${limits.maxConnectionsPerDocument}` });
        data.connection.close();
        return;
      }

      const perUserCount = countConnectionsForUser(data.instance, userId);
      if (perUserCount > limits.maxConnectionsPerUser) {
        await auditLimitEvent(pool, { orgId, projectId, documentId, userId, action: 'collab.limit_connections_per_user', reason: `${perUserCount} > ${limits.maxConnectionsPerUser}` });
        data.connection.close();
      }
    },

    async beforeSync(data) {
      if (data.type === SYNC_STEP_1) return;
      if (data.connection.readOnly) return;

      const { userId, orgId, projectId, documentId } = data.context;
      if (!userId || !orgId || !projectId || !documentId) return;

      const encodedSize = Y.encodeStateAsUpdate(data.document).byteLength;
      if (encodedSize > limits.maxEncodedStateBytes) {
        // SDD-008: read-only with a notice, not a close — the update is simply never applied, and every
        // future beforeSync call for this document hits this same branch again until it's archived.
        throw new Error('document has reached the maximum encoded state size and is now read-only; archive it and start a new one from its last version');
      }

      const renderedBytes = Buffer.byteLength(data.document.getText(BODY_ROOT).toString(), 'utf8');
      if (renderedBytes > limits.maxRenderedBytes) {
        throw new Error('document has reached the maximum rendered size and is now read-only');
      }

      if (!updateRate.tryConsume(`user:${userId}`, limits.maxUpdatesPerSecPerUser)) {
        await auditLimitEvent(pool, { orgId, projectId, documentId, userId, action: 'collab.limit_update_rate_user', reason: `> ${limits.maxUpdatesPerSecPerUser}/s` });
        throw new Error('update rate limit exceeded for this user');
      }
      if (!updateRate.tryConsume(`doc:${documentId}`, limits.maxUpdatesPerSecPerDocument)) {
        await auditLimitEvent(pool, { orgId, projectId, documentId, userId, action: 'collab.limit_update_rate_document', reason: `> ${limits.maxUpdatesPerSecPerDocument}/s` });
        throw new Error('update rate limit exceeded for this document');
      }
    },
  };
}
