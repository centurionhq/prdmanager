/**
 * Read-side of `doc_updates` (SDD-008 §"Autoría por línea no falsificable"): `packages/server`'s
 * `onChange`/`beforeSync` attribution hook (WO-149) owns writing rows; this module is the one place
 * anything reads them back — today the blame endpoint (WO-154) and version contributor computation
 * (WO-156). Kept tenant-scoped the same way every other repository in `repositories.ts` is.
 */
import { asc, desc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { docUpdates } from './schema/doc-updates.js';
import { withTenantTx } from './tenant.js';

export type DocUpdateActorKind = (typeof docUpdates.actorKind.enumValues)[number];

export interface StructRangeRow {
  client: number;
  from: number;
  to: number;
}

export interface DeleteRangeRow {
  client: number;
  clock: number;
  len: number;
}

export interface DocUpdateRow {
  seq: number;
  actorKind: DocUpdateActorKind | null;
  userId: string | null;
  onBehalfOf: string | null;
  agentId: string | null;
  update: Buffer;
  structRanges: StructRangeRow[];
  deleteRanges: DeleteRangeRow[];
  receivedAt: Date;
}

export interface DocUpdatesRepository {
  /** Every `doc_updates` row for `documentId`, oldest first — the full history, not just the
   * post-snapshot tail `onLoadDocument` replays (blame/contributors need every clock ever used, and a
   * debounced `working_state` snapshot already folds earlier rows into itself without erasing their
   * attribution). */
  listForDocument(documentId: string): Promise<DocUpdateRow[]>;
  /** The highest `seq` recorded for `documentId`, or `0` if none — cheap enough to poll for
   * cache-invalidation (WO-154) without re-reading every row's `update` bytea. */
  maxSeqForDocument(documentId: string): Promise<number>;
}

export function buildDocUpdatesRepository(pool: Pool, orgId: string): DocUpdatesRepository {
  return {
    listForDocument: (documentId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const rows = await tx.select().from(docUpdates).where(eq(docUpdates.documentId, documentId)).orderBy(asc(docUpdates.seq));
        return rows.map((row) => ({
          seq: row.seq,
          actorKind: row.actorKind,
          userId: row.userId,
          onBehalfOf: row.onBehalfOf,
          agentId: row.agentId,
          update: row.update,
          structRanges: row.structRanges as StructRangeRow[],
          deleteRanges: row.deleteRanges as DeleteRangeRow[],
          receivedAt: row.receivedAt,
        }));
      }),

    maxSeqForDocument: (documentId) =>
      withTenantTx(pool, orgId, async (tx) => {
        const [latest] = await tx.select({ seq: docUpdates.seq }).from(docUpdates).where(eq(docUpdates.documentId, documentId)).orderBy(desc(docUpdates.seq)).limit(1);
        return latest?.seq ?? 0;
      }),
  };
}
