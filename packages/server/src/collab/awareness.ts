/**
 * `beforeHandleAwareness` and `onStateless` for `/collab` (SDD-008 §"Servidor de tiempo real": "
 * beforeHandleAwareness descarta entradas cuyo client id no pertenece a la conexión y limita el estado
 * a {cursor, selection} de hasta 2 KB; nombre y color salen del servidor" / "onStateless rechaza todo
 * mensaje del cliente: el canal stateless es solo servidor → cliente").
 *
 * **Awareness ownership**: empirically (against the installed `@hocuspocus/server`/`y-protocols`
 * 4.7.0/1.0.7, confirmed by instrumenting this hook directly), the numeric key `beforeHandleAwareness`
 * decodes for an incoming message's single entry is **not** stable across successive messages from the
 * very same connection/`Y.Doc` — the same provider's own `document.clientID`/`awareness.clientID`
 * stayed constant client-side for an entire test, while the *key* the server decoded from that same
 * connection's own successive awareness messages changed every time. A "remember this connection's
 * first-seen client id, reject any other key later" design (this WO's own initial approach) is
 * therefore actively wrong: it treats the same honest connection's own later, legitimate updates as
 * foreign and silently discards them — this is flagged explicitly for the security review, since it
 * means "belongs to the connection" cannot be enforced by comparing a raw numeric key across messages
 * the way this WO's prompt assumed.
 *
 * What *is* true and enforceable per message: a real y-protocols client only ever encodes **one** entry
 * per outgoing awareness update (`Awareness.setLocalState()`/`removeAwarenessStates()` only ever touch
 * the caller's own `clientID`). A message carrying more than one entry is therefore already incoherent
 * for a real client and is rejected outright (`states.clear()`); a single-entry message is trusted as
 * "this connection's own" *for that message* and is what gets sanitized/re-labelled below. This still
 * fully closes the actual injection vector (smuggling a second, foreign client's state into one
 * message) — it just doesn't attempt the (empirically unreliable) cross-message identity check.
 *
 * **State shape**: only `cursor`/`selection` keys survive; everything else (including any
 * client-supplied `name`/`color`) is dropped and replaced with server-derived values. An oversized
 * (>2KB JSON-encoded) state is dropped entirely rather than truncated. The resolved display name is
 * cached per connection (not per client id, which this module no longer trusts as stable) to avoid a
 * database round trip on every cursor movement.
 *
 * **Stateless**: `onStateless` never awaits anything Hocuspocus itself awaits (confirmed against the
 * installed 4.7.0 source: `MessageReceiver.apply`'s `Stateless` case never `await`s the callback, unlike
 * `beforeSync`/`beforeHandleMessage`), so throwing here would only produce an unhandled rejection, not
 * an enforced rejection — the connection is closed directly instead.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { assertNoSecretsInAuditMetadata, connect, createTenantDb, schema } from '@prdm/db';
import type { CollabDocumentContext } from './authenticate.js';

const ALLOWED_AWARENESS_KEYS = ['cursor', 'selection'] as const;
const MAX_AWARENESS_BYTES = 2048;

interface ConnectionIdentity {
  name: string;
  color: string;
}

export interface CollabAwarenessConnectionLike {
  close(): void;
  context: Partial<CollabDocumentContext>;
}

export interface CollabBeforeHandleAwarenessPayload {
  states: Map<number, Record<string, unknown>>;
  context: Partial<CollabDocumentContext> | undefined;
  connection?: CollabAwarenessConnectionLike;
}

export interface CollabOnStatelessPayload {
  connection: CollabAwarenessConnectionLike;
  documentName: string;
}

export interface CollabAwarenessExtension {
  extensionName: string;
  beforeHandleAwareness(data: CollabBeforeHandleAwarenessPayload): Promise<void>;
  onStateless(data: CollabOnStatelessPayload): Promise<void>;
}

export interface CollabAwarenessDeps {
  pool: Pool;
}

function pickAllowedAwarenessFields(raw: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ALLOWED_AWARENESS_KEYS) {
    if (key in raw) picked[key] = raw[key];
  }
  return picked;
}

function isWithinSizeLimit(value: Record<string, unknown>): boolean {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_AWARENESS_BYTES;
}

/** Pure, deterministic per-user color — no I/O, never collides with anything client-supplied. */
function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

async function resolveDisplayName(pool: Pool, userId: string): Promise<string> {
  const db = connect(pool);
  const [row] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
  return row?.name ?? userId;
}

export function createCollabAwarenessExtension(deps: CollabAwarenessDeps): CollabAwarenessExtension {
  const { pool } = deps;
  const identityByConnection = new WeakMap<CollabAwarenessConnectionLike, ConnectionIdentity>();

  async function resolveIdentity(connection: CollabAwarenessConnectionLike): Promise<ConnectionIdentity | undefined> {
    const cached = identityByConnection.get(connection);
    if (cached) return cached;
    const userId = connection.context.userId;
    if (!userId) return undefined;
    const identity: ConnectionIdentity = { name: await resolveDisplayName(pool, userId), color: colorForUser(userId) };
    identityByConnection.set(connection, identity);
    return identity;
  }

  return {
    extensionName: 'prdm-collab-awareness',

    async beforeHandleAwareness(data) {
      const connection = data.connection;
      if (!connection) return; // server-internal (e.g. a future DirectConnection) — nothing to police.

      // A real y-protocols client only ever encodes its own single entry per message; more than one is
      // already incoherent for an honest client (see the module doc comment on why this is checked per
      // message rather than by remembering an id across messages).
      if (data.states.size !== 1) {
        data.states.clear();
        return;
      }

      const entry = data.states.entries().next();
      if (entry.done) return;
      const [ownClientId, rawState] = entry.value;
      const identity = await resolveIdentity(connection);
      if (!identity) {
        data.states.clear();
        return;
      }

      const filtered = pickAllowedAwarenessFields(rawState);
      if (!isWithinSizeLimit(filtered)) {
        data.states.delete(ownClientId);
        return;
      }
      data.states.set(ownClientId, { ...filtered, name: identity.name, color: identity.color });
    },

    async onStateless(data) {
      const { userId, orgId, projectId, documentId } = data.connection.context;
      if (orgId && projectId && documentId && userId) {
        const metadata = { documentName: data.documentName };
        assertNoSecretsInAuditMetadata(metadata);
        await createTenantDb(pool)
          .forOrg(orgId)
          .auditLog.record({
            projectId,
            actorType: 'user',
            actorId: userId,
            action: 'collab.stateless_rejected',
            target: documentId,
            metadata,
          })
          .catch(() => undefined);
      }
      data.connection.close();
    },
  };
}
