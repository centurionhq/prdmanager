/**
 * Row-locked per-project id assignment (SDD-007 "Documentos y flujo": "Id al crear ... con una sola
 * base la reserva es segura ... UPDATE id_counters ... RETURNING con lock de fila, sembrado desde los
 * ids existentes; nunca se reutilizan"; WO-131).
 *
 * `nextDocId` must run inside an already-open transaction (the caller's `withTenantTx`/tenant
 * transaction), since the `UPDATE ... RETURNING` it issues takes and holds a row lock on
 * `id_counters(project_id, kind)` until that transaction commits or rolls back — that lock, not
 * application code, is what makes concurrent callers for the same `(project, kind)` serialize instead
 * of racing to read-then-write the same `last_seq`.
 */
import { sql } from 'drizzle-orm';
import type { PgDatabase } from './pool.js';
import { documentKind } from './schema/documents.js';

export type DocumentKind = (typeof documentKind.enumValues)[number];

const ID_PAD = 3;

/** Same rendering as `@prdm/core`'s `nextId`/`ID_PATTERN`: `${kind}-${seq zero-padded to 3 digits}`, e.g. `PRD-012`. */
function formatDocId(kind: DocumentKind, seq: number): string {
  return `${kind}-${String(seq).padStart(ID_PAD, '0')}`;
}

/**
 * Returns the next id for `(projectId, kind)`, atomically incrementing `id_counters.last_seq` under a
 * row lock. Seeds the counter row on first use from `existingMaxSeq` (the caller — a future
 * `PgProjectEngine.scan()` — computes the current max sequence already used by `documents` rows for
 * this project/kind, so re-adopting a project with pre-existing ids never reissues one). Ids are never
 * reused even if a transaction that reserved one later rolls back: a gap from an aborted transaction is
 * expected and fine (SDD-007), only a *duplicate* would be a bug.
 */
export async function nextDocId(tx: PgDatabase, projectId: string, kind: DocumentKind, existingMaxSeq = 0): Promise<string> {
  // Seed row, only if missing: org_id comes from the tenant transaction's own current_setting, never a
  // caller-supplied argument, so this insert satisfies id_counters' RLS WITH CHECK by construction and
  // can never seed a row under the wrong org.
  await tx.execute(sql`
    INSERT INTO "id_counters" ("project_id", "org_id", "kind", "last_seq")
    VALUES (${projectId}, NULLIF(current_setting('app.org_id', true), ''), ${kind}, ${existingMaxSeq})
    ON CONFLICT ("project_id", "kind") DO NOTHING
  `);

  // The row lock: an UPDATE always locks the row(s) it touches until the transaction ends, so a second
  // concurrent caller for the same (project_id, kind) blocks here until the first commits or rolls back
  // — exactly the "contador bajo lock de fila" SDD-007 asks for, with no separate `SELECT ... FOR UPDATE`.
  const { rows } = await tx.execute<{ last_seq: number }>(sql`
    UPDATE "id_counters"
       SET "last_seq" = "last_seq" + 1
     WHERE "project_id" = ${projectId} AND "kind" = ${kind}
    RETURNING "last_seq"
  `);
  const row = rows[0];
  if (!row) throw new Error(`id_counters row for project ${projectId} kind ${kind} disappeared between seed and increment`);
  return formatDocId(kind, row.last_seq);
}
