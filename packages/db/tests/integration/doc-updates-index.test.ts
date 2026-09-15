/**
 * WO-226 — the standalone btree index on `doc_updates.document_id` is redundant: the unique constraint on
 * `(document_id, seq)` already provides a leading-column index covering every query in this codebase that
 * filters by `document_id` alone (`listForDocument`, `listSinceSeq`, `maxSeqForDocument`), so the extra
 * index was pure write overhead with no query benefit. This test confirms the standalone index is gone
 * after migrating, and that a `document_id`-only query still gets an index scan (via the unique
 * constraint's own index) rather than degrading to a sequential scan.
 */
import { openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg(); // runs every pending migration, including WO-226's drop, against the shared test DB
});

afterAll(async () => {
  await pg.close();
});

describe('doc_updates indexes after WO-226', () => {
  test('the redundant standalone document_id index no longer exists', async () => {
    const { rows } = await pg.ownerPool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename = 'doc_updates'`);
    const indexNames = rows.map((r) => r.indexname);
    expect(indexNames).not.toContain('doc_updates_document_id_idx');
  });

  test('the composite unique constraint index and the org_id index are both still present', async () => {
    const { rows } = await pg.ownerPool.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename = 'doc_updates'`);
    const indexNames = rows.map((r) => r.indexname);
    expect(indexNames).toContain('doc_updates_document_id_seq_key');
    expect(indexNames).toContain('doc_updates_org_id_idx');
  });

  test('a query filtering by document_id alone still gets an index scan, not a sequential scan', async () => {
    await truncateAll(pg.ownerPool);
    const client = await pg.ownerPool.connect();
    try {
      await client.query('BEGIN');
      // Forces the planner away from a sequential scan (the table is tiny in this test, so Postgres would
      // otherwise reasonably prefer one regardless of which indexes exist) — isolates the assertion to
      // "is there a usable index for this predicate", which is exactly what WO-226 needs to confirm.
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN SELECT * FROM doc_updates WHERE document_id = '00000000-0000-0000-0000-000000000000'`);
      const plan = explain.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(plan).toMatch(/Index.*Scan/i);
      expect(plan).toContain('doc_updates_document_id_seq_key');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
