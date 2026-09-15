/**
 * Live revocation (SDD-008 §"Servidor de tiempo real": "quitar miembro, bajar rol ... cierra las
 * conexiones afectadas (índice por usuario y documento)") — an in-process hub, no Redis/pub-sub (SDD-008
 * "Una sola instancia en el MVP"). Built once in `build-server.ts`, before either `/collab` or the
 * `/api/app/*` routes that mutate membership/documents exist, and threaded into both: `attach()` gives it
 * the live `Hocuspocus` instance once `register-collab-route.js` constructs one; `revokeUserProjectAccess`/
 * `revokeDocument` are called directly from `projects.ts`'s member routes and `documents.ts`'s archive
 * route right after their own write commits.
 *
 * Deliberately walks `Hocuspocus.documents`/`Document.connections` (its own real connection registry,
 * confirmed against `@hocuspocus/server` 4.7.0's `dist/index.d.ts`) rather than maintaining a second,
 * hand-rolled index that could drift from it — the only bookkeeping this module owns is which
 * `Hocuspocus` instance to walk.
 */
import type { Connection, Hocuspocus } from '@hocuspocus/server';
import type { CollabDocumentContext } from './authenticate.js';

export interface CollabRevocationHub {
  /** Called once, right after `register-collab-route.js` constructs the `Hocuspocus` instance. */
  attach(instance: Hocuspocus): void;
  /** Closes every open `/collab` connection this user holds for this specific project (member removed,
   * or their role changed) — never every connection they hold everywhere, so losing access to one
   * project doesn't disconnect them from an unrelated one they still belong to. */
  revokeUserProjectAccess(userId: string, projectId: string): void;
  /** Closes every open `/collab` connection to this document (archived). */
  revokeDocument(documentId: string): void;
  /** Closes every open `/collab` connection this user holds anywhere (session revoked / password
   * changed) — not wired to a specific better-auth hook in this batch (see the module doc comment on
   * `./revalidate.js`), but available for a future one, and exercised directly by this module's tests. */
  revokeUser(userId: string): void;
}

type CollabConnection = Connection<Partial<CollabDocumentContext>>;

function forEachCollabConnection(instance: Hocuspocus | undefined, predicate: (context: Partial<CollabDocumentContext>) => boolean): void {
  if (!instance) return;
  instance.documents.forEach((document) => {
    document.connections.forEach((_meta, connection) => {
      const collabConnection = connection as CollabConnection;
      if (predicate(collabConnection.context ?? {})) {
        collabConnection.close();
      }
    });
  });
}

export function createCollabRevocationHub(): CollabRevocationHub {
  let instance: Hocuspocus | undefined;

  return {
    attach(next) {
      instance = next;
    },
    revokeUserProjectAccess(userId, projectId) {
      forEachCollabConnection(instance, (ctx) => ctx.userId === userId && ctx.projectId === projectId);
    },
    revokeDocument(documentId) {
      forEachCollabConnection(instance, (ctx) => ctx.documentId === documentId);
    },
    revokeUser(userId) {
      forEachCollabConnection(instance, (ctx) => ctx.userId === userId);
    },
  };
}

/** A hub that never attaches to a real `Hocuspocus` instance — the default for any route registration
 * that doesn't pass one explicitly, so every existing call site keeps working unchanged. */
export function createNoopCollabRevocationHub(): CollabRevocationHub {
  return createCollabRevocationHub();
}
