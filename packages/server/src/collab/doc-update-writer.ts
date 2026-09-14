/**
 * Durable `doc_updates`/`doc_client_bindings` writes (SDD-008 §"Autoría por línea no falsificable"),
 * batched per document over a window of at most `maxDelayMs` (default 50ms) rather than one transaction
 * per keystroke: `DocUpdateBatcher.enqueue` returns a promise that resolves only once the row it queued
 * is durably committed, so `onChange` (`./attribution.js`) can `await` it before returning — Hocuspocus
 * awaits every hook before broadcasting or continuing, so this is what makes the write happen strictly
 * before broadcast without needing a Redis/pub-sub layer of its own (SDD-008 "una sola instancia").
 *
 * Exactly one batch (and one pending flush) is ever in flight per document at a time: `enqueue` chains
 * onto the previous flush's promise for that document rather than starting a second one concurrently,
 * so `seq` allocation (`SELECT MAX(seq)+1`, guarded by a `pg_advisory_xact_lock` for defense in depth —
 * same pattern as `PgProjectEngine`'s own per-project write lock) can never race with itself even if a
 * batch window closes while the previous one's transaction is still committing.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { schema, withTenantTx } from '@prdm/db';
import type { DeleteRange, StructRange } from '@prdm/collab';
import type { CollabBatchScheduler } from './batch-scheduler.js';
import { createDocSizeTracker, type DocSizeTracker } from './doc-size-tracker.js';

/** Distinct from `PgProjectEngine`'s own `WRITE_LOCK_SALT`/`PROJECTION_LOCK_SALT` (different keyspace
 * entirely: this locks on a *document* uuid, that on a *project* uuid) — an arbitrary constant, only
 * required to be stable and unique among this codebase's other `hashtextextended` salts. */
const DOC_UPDATES_LOCK_SALT = 0x5044_5530; // 'PDU0'

export type DocUpdateActorKind = 'user' | 'agent' | 'system';

export interface PendingDocUpdateRow {
  update: Buffer;
  structRanges: StructRange[];
  deleteRanges: DeleteRange[];
  actorKind: DocUpdateActorKind;
  userId: string | null;
  onBehalfOf: string | null;
  agentId: string | null;
  connectionId: string | null;
}

const DEFAULT_MAX_DELAY_MS = 50;

async function writeDocUpdateBatch(pool: Pool, orgId: string, documentId: string, rows: readonly PendingDocUpdateRow[]): Promise<void> {
  await withTenantTx(pool, orgId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${documentId}::text, ${DOC_UPDATES_LOCK_SALT}))`);

    const [latest] = await tx
      .select({ seq: schema.docUpdates.seq })
      .from(schema.docUpdates)
      .where(eq(schema.docUpdates.documentId, documentId))
      .orderBy(desc(schema.docUpdates.seq))
      .limit(1);
    let nextSeq = (latest?.seq ?? 0) + 1;

    for (const row of rows) {
      await tx.insert(schema.docUpdates).values({
        orgId,
        documentId,
        seq: nextSeq++,
        actorKind: row.actorKind,
        userId: row.userId,
        onBehalfOf: row.onBehalfOf,
        agentId: row.agentId,
        connectionId: row.connectionId,
        update: row.update,
        structRanges: row.structRanges,
        deleteRanges: row.deleteRanges,
      });

      // First-writer-wins binding (SDD-008): only ever attempted for a real authenticated user's own
      // edit — an `agent`/`system` actor's structs are deliberately never bound to a *user* row here
      // (a future WO extends this once agent/system server-attributed transactions exist in this
      // batch's scope; today the only such origin, WO-139's pending-patch bootstrap, is applied before
      // `onChange` is ever wired up — see `persistence.ts`'s own note).
      if (row.actorKind === 'user' && row.userId) {
        for (const range of row.structRanges) {
          await tx
            .insert(schema.docClientBindings)
            .values({ documentId, orgId, clientId: String(range.client), userId: row.userId, actorKind: row.actorKind })
            .onConflictDoNothing({ target: [schema.docClientBindings.documentId, schema.docClientBindings.clientId] });
        }
      }
    }
  });
}

interface PendingBatch {
  rows: PendingDocUpdateRow[];
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
  cancelTimer: () => void;
}

export interface DocUpdateBatcherDeps {
  pool: Pool;
  scheduler: CollabBatchScheduler;
  maxDelayMs?: number;
  /** WO-221: incremented by the exact byte length of each batch's rows once it durably commits, so
   * `limits.ts`'s encoded-state-size check never has to recompute `Y.encodeStateAsUpdate` itself. Defaults
   * to a fresh, unshared tracker (harmless for callers — e.g. existing tests — that don't care about size
   * tracking); `register-collab-route.ts` passes the one shared instance every other extension reads. */
  sizeTracker?: DocSizeTracker;
}

export interface DocUpdateBatcher {
  /** Resolves once `row` is durably committed (as part of whatever batch it ended up in). Rejects if
   * that batch's transaction fails — the caller (`onChange`) treats that as its own failure. */
  enqueue(orgId: string, documentId: string, row: PendingDocUpdateRow): Promise<void>;
}

export function createDocUpdateBatcher(deps: DocUpdateBatcherDeps): DocUpdateBatcher {
  const { pool, scheduler, maxDelayMs = DEFAULT_MAX_DELAY_MS, sizeTracker = createDocSizeTracker() } = deps;
  const pendingByDocument = new Map<string, PendingBatch>();
  // Chains flushes for the same document strictly one-after-another (see module doc comment).
  let flushChain: Promise<void> = Promise.resolve();

  function flush(documentId: string, orgId: string): void {
    const batch = pendingByDocument.get(documentId);
    if (!batch) return;
    pendingByDocument.delete(documentId);

    flushChain = flushChain.then(
      () =>
        writeDocUpdateBatch(pool, orgId, documentId, batch.rows).then(
          () => {
            // WO-221: the exact byte length of what was just durably written — cheaper than, and
            // equivalent in effect to, re-encoding the whole document to find out its new size.
            const totalBytes = batch.rows.reduce((sum, row) => sum + row.update.byteLength, 0);
            sizeTracker.addBytes(documentId, totalBytes);
            batch.waiters.forEach((w) => w.resolve());
          },
          (error: unknown) => batch.waiters.forEach((w) => w.reject(error)),
        ),
      // A previous document's flush failing must never poison this one's turn in the chain.
      () => undefined,
    );
  }

  return {
    enqueue(orgId, documentId, row) {
      return new Promise((resolve, reject) => {
        let batch = pendingByDocument.get(documentId);
        if (!batch) {
          const cancelTimer = scheduler.scheduleTimeout(() => flush(documentId, orgId), maxDelayMs);
          batch = { rows: [], waiters: [], cancelTimer };
          pendingByDocument.set(documentId, batch);
        }
        batch.rows.push(row);
        batch.waiters.push({ resolve, reject });
      });
    },
  };
}
