/**
 * WO-244 — the actual CI-only Postgres `deadlock detected` (`40P01`) that `packages/server/tests/collab/
 * live-validation.test.ts`'s `afterEach` (`truncateAll`, `packages/testkit/src/pg.ts`) hit, and that
 * WO-242's earlier (wrong) fix did not address: WO-242 assumed the deadlocking relation OIDs from CI's
 * error `detail` (17071 and 16935) were `doc_updates`/`doc_client_bindings`. A direct `pg_class` query
 * shows they're actually `doc_updates` (17071) and `documents` (16935) — `doc_client_bindings` (17117) was
 * never involved. The real conflicting transaction was `packages/server/src/collab/persistence.ts`'s
 * `onStoreDocument`, which used to `SELECT` from `doc_updates` and only then `UPDATE documents` — the
 * exact reverse of `truncateAll`'s own `pg_class.oid` order (`documents`, created first, is truncated
 * before `doc_updates`). Confirmed by direct reproduction (see this test's second case, and the manual
 * `pg_locks` inspection recorded in this WO) before the fix, and confirmed gone after it, including under
 * an artificially widened race window — this bug's whole nature is that it doesn't reproduce under normal
 * local timing, so "ran once and passed" is not enough evidence on its own.
 */
import { randomUUID } from 'node:crypto';
import { createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

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

async function insertDocumentFixture(orgId: string, projectId: string): Promise<string> {
  const id = randomUUID();
  await pg.ownerPool.query(
    `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
     VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/PRD-001-test.md', 'collab', 'draft')`,
    [id, orgId, projectId, `PRD-${id.slice(0, 8)}`],
  );
  return id;
}

/** Polls `pg_stat_activity` (never a fixed sleep) until `truncateAll`'s own `TRUNCATE` is genuinely,
 * observably blocked on a lock — a real server-side fact, not an assumption about timing. */
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

describe('documents/doc_updates lock ordering (WO-244)', () => {
  test('an onStoreDocument-shaped transaction (touch documents, then doc_updates) never deadlocks against a concurrent truncateAll', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(org.id, project.id);

    const writer = await pg.ownerPool.connect();
    try {
      await writer.query('BEGIN');
      // Mirrors persistence.ts's onStoreDocument, fixed: touch `documents` first (matching truncateAll's
      // own oid order), only then read `doc_updates`.
      await writer.query('SELECT id FROM documents WHERE id = $1', [documentId]);

      const truncatePromise = truncateAll(pg.ownerPool);

      // Real, polled evidence that truncateAll's own TRUNCATE is genuinely mid-flight and lock-blocked
      // on some earlier table in its oid-ordered list before this writer proceeds — never a fixed sleep.
      await waitUntilTruncateIsBlocked(pg.ownerPool);

      // With the fix, this writer already holds documents's lock (acquired above, before truncateAll
      // could reach it), so truncateAll is necessarily still queued behind documents (or something
      // earlier in its list) — it can never have already grabbed doc_updates's AccessExclusiveLock, so
      // this SELECT (an AccessShareLock request on doc_updates) succeeds immediately: no deadlock.
      await writer.query('SELECT seq FROM doc_updates WHERE document_id = $1 ORDER BY seq DESC LIMIT 1', [documentId]);
      await writer.query('UPDATE documents SET updated_at = now() WHERE id = $1', [documentId]);
      await writer.query('COMMIT');

      await expect(truncatePromise).resolves.toBeUndefined();
    } finally {
      writer.release();
    }
  });

  test('reproduces the real WO-244 deadlock when a transaction touches doc_updates before documents (regression guard)', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(org.id, project.id);

    const writer = await pg.ownerPool.connect();
    try {
      await writer.query('BEGIN');
      // Deliberately mirrors the OLD (buggy) persistence.ts order: doc_updates first, documents second —
      // the exact reverse of truncateAll's own oid order. This must fail with a real Postgres deadlock,
      // not hang or succeed — if this assertion ever starts failing, `persistence.ts`'s onStoreDocument
      // (or truncateAll's own table order) has silently regressed back to the WO-244 bug.
      await writer.query('SELECT seq FROM doc_updates WHERE document_id = $1 ORDER BY seq DESC LIMIT 1', [documentId]);

      const truncatePromise = truncateAll(pg.ownerPool).then(
        () => ({ ok: true as const }),
        (error: Error & { code?: string }) => ({ ok: false as const, code: error.code, message: error.message }),
      );

      await waitUntilTruncateIsBlocked(pg.ownerPool);

      const updateResult = await writer
        .query('UPDATE documents SET updated_at = now() WHERE id = $1', [documentId])
        .then(
          () => ({ ok: true as const }),
          (error: Error & { code?: string }) => ({ ok: false as const, code: error.code, message: error.message }),
        )
        .finally(() => writer.query('COMMIT').catch(() => {}));

      const truncateResult = await truncatePromise;

      // Exactly one side of this AB-BA cycle is the one Postgres kills with `40P01`; the other proceeds.
      const results = [truncateResult, updateResult];
      const deadlocked = results.filter((r) => !r.ok && r.code === '40P01');
      const succeeded = results.filter((r) => r.ok);
      expect(deadlocked).toHaveLength(1);
      expect(succeeded).toHaveLength(1);
    } finally {
      writer.release();
    }
  });
});
