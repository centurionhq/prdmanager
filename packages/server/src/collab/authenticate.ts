/**
 * `onAuthenticate` for `/collab` (SDD-008 §"Servidor de tiempo real"): runs once per document even
 * though a single WebSocket may multiplex several (confirmed by the ADR-006 learning test). The
 * upgrade's session was already resolved once, per-socket, by `register-collab-route.js`'s
 * `preValidation` — this hook only does the per-*document* authorization: parse `documentName`, resolve
 * its org/project via `resolve_document`, look up the caller's effective role, and reject (throw) unless
 * they can at least `view` it. Read-only is decided by `can(subject, 'edit_document')` — never a
 * hand-rolled role list — plus two SDD-008-specific overrides: a `generated`-origin document (no working
 * copy of its own) and an `archived` one are always read-only regardless of role.
 *
 * Every rejection throws the same generic error, deliberately indistinguishable whether the document
 * doesn't exist, belongs to another organization, or the caller simply has no access (SDD-006 §Arquitectura:
 * "Cualquier recurso de otra organización o proyecto responde 404, nunca 403" — the WS equivalent of
 * that is one permission-denied reason, never a hint).
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { can } from '@prdm/contracts';
import { resolveDocumentById, schema, withTenantTx } from '@prdm/db';
import { parseDocumentName } from './document-name.js';
import { resolveCollabPermissionSubject } from './resolve-subject.js';

export interface CollabAuthContext {
  /** Seeded by `register-collab-route.js` into `handleConnection`'s `defaultContext`, from the session
   * already resolved during the WebSocket upgrade's `preValidation`. */
  userId: string;
}

export interface CollabDocumentContext extends CollabAuthContext {
  orgId: string;
  projectId: string;
  documentId: string;
}

export class CollabPermissionDeniedError extends Error {
  constructor() {
    super('permission denied');
    this.name = 'CollabPermissionDeniedError';
  }
}

/** Structurally matches `@hocuspocus/server`'s `onAuthenticatePayload` (see the persistence module's
 * own note on why this package never imports Hocuspocus's types directly). */
export interface CollabAuthenticatePayload {
  documentName: string;
  context: Partial<CollabAuthContext>;
  connectionConfig: { readOnly: boolean; isAuthenticated: boolean };
}

export interface CollabAuthenticateExtension {
  extensionName: string;
  onAuthenticate(data: CollabAuthenticatePayload): Promise<CollabDocumentContext>;
}

export interface CollabAuthenticateDeps {
  pool: Pool;
}

export function createCollabAuthenticateExtension(deps: CollabAuthenticateDeps): CollabAuthenticateExtension {
  const { pool } = deps;

  return {
    extensionName: 'prdm-collab-authenticate',

    async onAuthenticate(data) {
      const userId = data.context.userId;
      if (!userId) throw new CollabPermissionDeniedError();

      const parsed = parseDocumentName(data.documentName);
      if (!parsed) throw new CollabPermissionDeniedError();

      const resolved = await resolveDocumentById(pool, parsed.documentId);
      if (!resolved || resolved.projectId !== parsed.projectId) throw new CollabPermissionDeniedError();

      const subject = await resolveCollabPermissionSubject(pool, resolved.orgId, parsed.projectId, userId);
      if (!subject || !can(subject, 'view')) throw new CollabPermissionDeniedError();

      const documentRow = await withTenantTx(pool, resolved.orgId, async (tx) => {
        const [row] = await tx
          .select({ origin: schema.documents.origin, workflowState: schema.documents.workflowState })
          .from(schema.documents)
          .where(eq(schema.documents.id, parsed.documentId));
        return row ?? null;
      });
      if (!documentRow) throw new CollabPermissionDeniedError();

      const forcedReadOnly = documentRow.origin === 'generated' || documentRow.workflowState === 'archived';
      data.connectionConfig.readOnly = forcedReadOnly || !can(subject, 'edit_document');

      const context: CollabDocumentContext = { userId, orgId: resolved.orgId, projectId: parsed.projectId, documentId: parsed.documentId };
      return context;
    },
  };
}
