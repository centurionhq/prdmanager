/**
 * Periodic per-connection revalidation (SDD-008 §"Servidor de tiempo real": "cada conexión revalida
 * sesión y rol cada 60 segundos"). Runs on the injected `CollabScheduler` (`./scheduler.js`) — never a
 * bare `setInterval` a test would have to wait out — started once a connection is fully established
 * (Hocuspocus's `connected` hook, the first hook whose payload actually carries the `Connection`
 * instance) and stopped via that same `Connection`'s own `onClose` callback, so there is exactly one
 * timer per connection and it can never outlive it.
 *
 * Re-checks two independent things, closing the connection the moment either fails:
 * 1. The session is still valid — re-running `auth.api.getSession` against the *same* raw `Cookie`
 *    header captured at upgrade time (`./authenticate.js`), the same mechanism `requireAppSession` uses
 *    for every `/api/app/*` request, so a revoked session or a changed password (which invalidates the
 *    session row) is caught within one interval — this is this batch's mechanism for those two SDD-008
 *    triggers, rather than hooking better-auth's internal session/credential plugins directly.
 * 2. The role/document check is still satisfied (`./authorize-document.js`, shared with `onAuthenticate`)
 *    — also keeps `connection.readOnly` in sync with a role or document-state change that doesn't fully
 *    revoke access (e.g. downgraded from editor to viewer, or the document got archived) without having
 *    to disconnect for that case.
 */
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { CollabDocumentContext } from './authenticate.js';
import { authorizeCollabDocument } from './authorize-document.js';
import type { CollabScheduler } from './scheduler.js';

const DEFAULT_REVALIDATE_INTERVAL_MS = 60_000;

export interface CollabConnectionLike {
  context: Partial<CollabDocumentContext>;
  readOnly: boolean;
  close(): void;
  onClose(callback: () => void): unknown;
}

export interface CollabConnectedPayloadLike {
  connection: CollabConnectionLike;
}

export interface CollabRevalidateExtension {
  extensionName: string;
  connected(data: CollabConnectedPayloadLike): Promise<void>;
}

export interface CollabRevalidateDeps {
  auth: Auth;
  pool: Pool;
  scheduler: CollabScheduler;
  intervalMs?: number;
}

async function isSessionStillValid(auth: Auth, sessionCookie: string, expectedUserId: string): Promise<boolean> {
  try {
    const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) });
    return session?.user?.id === expectedUserId;
  } catch {
    return false;
  }
}

async function revalidateOnce(auth: Auth, pool: Pool, connection: CollabConnectionLike): Promise<void> {
  const { userId, sessionCookie, orgId, projectId, documentId } = connection.context;
  if (!userId || !sessionCookie || !orgId || !projectId || !documentId) {
    connection.close();
    return;
  }

  if (!(await isSessionStillValid(auth, sessionCookie, userId))) {
    connection.close();
    return;
  }

  const authorization = await authorizeCollabDocument(pool, { orgId, projectId, documentId, userId });
  if (!authorization) {
    connection.close();
    return;
  }
  connection.readOnly = authorization.readOnly;
}

export function createCollabRevalidateExtension(deps: CollabRevalidateDeps): CollabRevalidateExtension {
  const { auth, pool, scheduler, intervalMs = DEFAULT_REVALIDATE_INTERVAL_MS } = deps;

  return {
    extensionName: 'prdm-collab-revalidate',

    async connected(data) {
      const cancel = scheduler.scheduleInterval(() => revalidateOnce(auth, pool, data.connection), intervalMs);
      data.connection.onClose(() => cancel());
    },
  };
}
