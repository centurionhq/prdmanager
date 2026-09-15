/**
 * `onAuthenticate` for `/collab` (SDD-008 §"Servidor de tiempo real"): runs once per document even
 * though a single WebSocket may multiplex several (confirmed by the ADR-006 learning test). The
 * upgrade's session was already resolved once, per-socket, by `register-collab-route.js`'s
 * `preValidation` — this hook only does the per-*document* authorization: parse `documentName`, resolve
 * its org/project via `resolve_document`, then defer the actual view/read-only decision to
 * `./authorize-document.js` (shared with WO-148's periodic revalidation, so the two can never disagree).
 *
 * Every rejection throws the same generic error, deliberately indistinguishable whether the document
 * doesn't exist, belongs to another organization, or the caller simply has no access (SDD-006 §Arquitectura:
 * "Cualquier recurso de otra organización o proyecto responde 404, nunca 403" — the WS equivalent of
 * that is one permission-denied reason, never a hint).
 */
import type { Pool } from 'pg';
import { resolveDocumentById } from '@prdm/db';
import { authorizeCollabDocument } from './authorize-document.js';
import { parseDocumentName } from './document-name.js';

export interface CollabAuthContext {
  /** Seeded by `register-collab-route.js` into `handleConnection`'s `defaultContext`, from the session
   * already resolved during the WebSocket upgrade's `preValidation`. */
  userId: string;
  /** The upgrade request's raw `Cookie` header (WO-148): kept only to let the periodic revalidation
   * extension (`./revalidate.js`) re-run the exact same session check every 60s, never sent anywhere
   * else and never logged. */
  sessionCookie: string;
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
      const sessionCookie = data.context.sessionCookie;
      if (!userId || !sessionCookie) throw new CollabPermissionDeniedError();

      const parsed = parseDocumentName(data.documentName);
      if (!parsed) throw new CollabPermissionDeniedError();

      const resolved = await resolveDocumentById(pool, parsed.documentId);
      if (!resolved || resolved.projectId !== parsed.projectId) throw new CollabPermissionDeniedError();

      const authorization = await authorizeCollabDocument(pool, { orgId: resolved.orgId, projectId: parsed.projectId, documentId: parsed.documentId, userId });
      if (!authorization) throw new CollabPermissionDeniedError();

      data.connectionConfig.readOnly = authorization.readOnly;

      const context: CollabDocumentContext = { userId, sessionCookie, orgId: resolved.orgId, projectId: parsed.projectId, documentId: parsed.documentId };
      return context;
    },
  };
}
