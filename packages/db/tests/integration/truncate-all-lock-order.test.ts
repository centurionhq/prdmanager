/**
 * WO-242 — a genuine, CI-only Postgres `deadlock detected` (`40P01`, never `40001`/a lock-wait timeout)
 * inside `truncateAll` (`packages/testkit/src/pg.ts`), racing `packages/server/src/collab/doc-update-
 * writer.ts`'s `writeDocUpdateBatch` (the only multi-table, fixed-order write transaction in this
 * codebase's collab code — `doc_updates` first, then `doc_client_bindings`). Root cause: the old query
 * (`SELECT tablename FROM pg_catalog.pg_tables ...`, no `ORDER BY`) listed `TRUNCATE`'s target tables in
 * whatever arbitrary order the catalog scan returned — unrelated to, and sometimes the exact opposite of,
 * `writeDocUpdateBatch`'s own fixed insert order. When it landed on the opposite order while that write
 * was still in flight, `TRUNCATE` (holding table A, waiting on table B) and the write (holding table B,
 * waiting on table A) formed a textbook AB-BA lock-order deadlock. Never reproduced locally: it requires
 * a `writeDocUpdateBatch` transaction to still be uncommitted at the *exact* moment `truncateAll` issues
 * its `TRUNCATE`, a window wide enough to hit only under a loaded/weaker CI runner.
 *
 * A live repro (see this test's own second case) surfaced one more layer worth recording: an `INSERT`
 * into `doc_updates` doesn't just lock `doc_updates` — its `org_id`/`document_id`/`user_id` foreign keys
 * each take an implicit `RowShareLock` on the *referenced* table too (`organization`/`documents`/`user`),
 * standard Postgres FK-enforcement behavior. Since those parent tables were all created (far) earlier
 * than `doc_updates` (lower `oid`), creation-order locking makes `TRUNCATE` queue behind whichever of
 * *those* it reaches first — never even reaching `doc_updates`/`doc_client_bindings` while blocked — which
 * is exactly why this ordering is deadlock-safe in general, not just for this one known pair: any
 * transaction whose own lock order follows FK/dependency order (parent rows must already exist before a
 * child can reference them) can only ever queue behind creation-order locking, never cycle against it.
 *
 * Both tests below are fully deterministic — no timing-based assertion, no sleep, no retry loop papering
 * over a real race:
 *  - the first proves the *fix* directly: `truncateAll`'s own `TRUNCATE` statement always lists
 *    `doc_updates` before `doc_client_bindings`, matching `writeDocUpdateBatch`'s own order;
 *  - the second reproduces the actual adversarial scenario with two real, independently-controlled
 *    Postgres connections (one playing `writeDocUpdateBatch`, one running the real `truncateAll`),
 *    synchronized via `pg_stat_activity` polling (a real, observable server-side fact — never a fixed
 *    wait) rather than assuming either side finishes within some hardcoded delay, and asserts neither a
 *    deadlock nor any other error occurs.
 */
import { randomUUID } from 'node:crypto';
import { createOrganizationFixture, createProjectFixture, createUserFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg();
});

beforeEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

/** Polls `pg_stat_activity` (never a fixed sleep) until the given `TRUNCATE` statement's own backend is
 * genuinely, observably blocked on a lock (`wait_event_type = 'Lock'`) — a real, server-side fact, not an
 * assumption about how long anything takes. Deliberately doesn't pin down *which* table it's blocked on:
 * a foreign-key-referencing `INSERT` (e.g. `doc_updates.org_id → organization.id`) takes an implicit
 * `RowShareLock` on the *referenced* table too, so `TRUNCATE`'s creation-order list can end up queuing
 * behind an older, foreign-key-parent table (`organization`) before it ever reaches `doc_updates` itself —
 * still exactly the "queued, not deadlocked" behavior this fix relies on. */
async function waitUntilTruncateIsBlocked(pool: PgTestDb['ownerPool']): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await pool.query<{ blocked: boolean }>(
      `SELECT true AS blocked
       FROM pg_stat_activity
       WHERE query ILIKE 'TRUNCATE TABLE%' AND wait_event_type = 'Lock'
       LIMIT 1`,
    );
    if (rows.length > 0) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for the concurrent TRUNCATE to be lock-blocked');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function insertDocumentFixture(orgId: string, projectId: string): Promise<string> {
  const id = randomUUID();
  await pg.ownerPool.query(
    `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
     VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/PRD-001-test.md', 'collab', 'draft')`,
    [id, orgId, projectId, `PRD-${id.slice(0, 8)}`],
  );
  return id;
}

describe('truncateAll lock ordering (WO-242)', () => {
  test('the generated TRUNCATE statement always lists doc_updates before doc_client_bindings', async () => {
    const querySpy = vi.spyOn(pg.ownerPool, 'query');
    await truncateAll(pg.ownerPool);

    const truncateSql = querySpy.mock.calls.map((call) => String(call[0])).find((sql) => sql.trim().startsWith('TRUNCATE'));
    expect(truncateSql).toBeDefined();

    const docUpdatesIndex = truncateSql!.indexOf('"doc_updates"');
    const docClientBindingsIndex = truncateSql!.indexOf('"doc_client_bindings"');
    expect(docUpdatesIndex).toBeGreaterThanOrEqual(0);
    expect(docClientBindingsIndex).toBeGreaterThanOrEqual(0);
    // packages/server/src/collab/doc-update-writer.ts's `writeDocUpdateBatch` always inserts into
    // `doc_updates` before `doc_client_bindings` — matching that order is exactly what makes a
    // concurrent TRUNCATE structurally unable to form an AB-BA cycle with that transaction.
    expect(docUpdatesIndex).toBeLessThan(docClientBindingsIndex);

    querySpy.mockRestore();
  });

  test('a writeDocUpdateBatch-shaped transaction never deadlocks against a concurrent truncateAll', async () => {
    const org = await createOrganizationFixture(pg);
    const user = await createUserFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(org.id, project.id);

    const writer = await pg.ownerPool.connect();
    try {
      await writer.query('BEGIN');
      // Mirrors writeDocUpdateBatch's own first statement: an INSERT into doc_updates, acquiring a
      // RowExclusiveLock on it and holding it open (uncommitted) for the rest of this test.
      await writer.query(
        `INSERT INTO "doc_updates" (org_id, document_id, seq, actor_kind, user_id, update)
         VALUES ($1, $2, 1, 'user', $3, $4)`,
        [org.id, documentId, user.id, Buffer.from([1, 2, 3])],
      );

      // The real truncateAll, racing this still-open transaction — started but not yet awaited.
      const truncatePromise = truncateAll(pg.ownerPool);

      // Wait for truncateAll's own TRUNCATE to genuinely be queued behind a lock this writer transaction
      // holds (a real, polled server-side fact) before proceeding — guarantees the next statement below
      // runs exactly inside the race window this WO is about, rather than merely hoping it does.
      await waitUntilTruncateIsBlocked(pg.ownerPool);

      // Mirrors writeDocUpdateBatch's own second statement. With the fix, truncateAll's TRUNCATE is
      // still queued behind an earlier (lower-oid) table it hasn't gotten past yet — creation order
      // guarantees it can never have already grabbed doc_client_bindings before reaching this point —
      // so this succeeds immediately: no deadlock, no wait.
      await writer.query(
        `INSERT INTO "doc_client_bindings" (document_id, client_id, org_id, user_id, actor_kind)
         VALUES ($1, '1', $2, $3, 'user')`,
        [documentId, org.id, user.id],
      );
      await writer.query('COMMIT');

      await expect(truncatePromise).resolves.toBeUndefined();
    } finally {
      writer.release();
    }
  });
});
