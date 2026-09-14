/**
 * WO-224 — `listThreads` used to fetch all threads for a document, then loop with one sequential `await`
 * per thread to fetch that thread's comments: an N+1 query pattern. Fixed to fetch every comment for every
 * listed thread in a single `WHERE thread_id = ANY(...)` query and group them in memory.
 *
 * No existing test in this repo counts DB round trips (checked before inventing this), so this file wraps
 * `pg.appPool.connect()` — the exact call `drizzle-orm`'s node-postgres transaction driver makes to obtain
 * the client it then issues every query on (confirmed against the installed `drizzle-orm` source) — to
 * count `SELECT` statements issued during a single `listThreads` call, independent of wall-clock timing.
 */
import { randomUUID } from 'node:crypto';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, createUserFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

async function insertDocumentFixture(pool: Pool, overrides: { orgId: string; projectId: string }): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "documents" (id, org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
     VALUES ($1, $2, $3, $4, 'PRD', 'Test doc', 'docs/prd/PRD-001-test.md', 'collab', 'draft')`,
    [id, overrides.orgId, overrides.projectId, `PRD-${id.slice(0, 8)}`],
  );
  return id;
}

/** Counts `SELECT` statements issued on the client(s) `pool.connect()` hands out — the exact mechanism
 * `withTenantTx`'s `drizzle-orm` transaction uses — while `run` is in flight. Restores the pool afterward
 * regardless of `run`'s outcome. */
async function countSelectQueriesDuring<T>(pool: Pool, run: () => Promise<T>): Promise<{ result: T; selectCount: number }> {
  const originalConnect = pool.connect.bind(pool);
  let selectCount = 0;
  (pool as unknown as { connect: typeof pool.connect }).connect = (async (...args: unknown[]) => {
    const client = (await (originalConnect as (...a: unknown[]) => Promise<PoolClient>)(...args)) as PoolClient;
    const originalQuery = client.query.bind(client);
    (client as unknown as { query: unknown }).query = ((...queryArgs: unknown[]) => {
      const first = queryArgs[0];
      const text = typeof first === 'string' ? first : (first as { text?: string } | undefined)?.text;
      // Excludes `withTenantTx`'s own per-transaction `SELECT set_config(...)` bootstrap (constant
      // overhead, unrelated to how many threads/comments exist) — only counts real reads of this
      // repository's own tables.
      if (text && /^\s*select/i.test(text) && /"doc_comment/i.test(text)) selectCount += 1;
      return (originalQuery as (...a: unknown[]) => unknown)(...queryArgs);
    }) as typeof client.query;
    return client;
  }) as typeof pool.connect;

  try {
    const result = await run();
    return { result, selectCount };
  } finally {
    (pool as unknown as { connect: typeof pool.connect }).connect = originalConnect;
  }
}

describe('doc-comments-repository listThreads (SDD-008, WO-224)', () => {
  test('fetches every thread’s comments in one query, not one query per thread', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id });
    const author = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    const THREAD_COUNT = 6;
    const createdThreadIds: string[] = [];
    for (let i = 0; i < THREAD_COUNT; i += 1) {
      const { thread } = await db.docComments.createThread({
        documentId,
        anchorStart: Buffer.from([i]),
        anchorEnd: Buffer.from([i + 1]),
        quotedText: `quote ${i}`,
        createdBy: author.id,
        body: `opening comment ${i}`,
      });
      createdThreadIds.push(thread.id);
      // A varying number of replies per thread, so "comments grouped correctly" isn't trivially true for
      // a uniform shape.
      for (let r = 0; r < i % 3; r += 1) {
        await db.docComments.addReply(thread.id, author.id, `reply ${r} on thread ${i}`);
      }
    }

    const { result: threads, selectCount } = await countSelectQueriesDuring(pg.appPool, () => db.docComments.listThreads(documentId));

    // O(1): one query for the threads, one for all their comments — never one per thread.
    expect(selectCount).toBeLessThanOrEqual(2);

    expect(threads.map((t) => t.thread.id)).toEqual(createdThreadIds);
    for (const [i, entry] of threads.entries()) {
      expect(entry.comments.length).toBe(1 + (i % 3)); // opening comment + replies
      expect(entry.comments.every((c) => c.threadId === entry.thread.id)).toBe(true);
      const timestamps = entry.comments.map((c) => c.createdAt.getTime());
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    }
  });

  test('a thread with no comments (defensive: should not normally happen) is still listed with an empty array', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const documentId = await insertDocumentFixture(pg.ownerPool, { orgId: org.id, projectId: project.id });
    const author = await createUserFixture(pg);
    const db = createTenantDb(pg.appPool).forOrg(org.id);

    const { thread } = await db.docComments.createThread({
      documentId,
      anchorStart: Buffer.from([0]),
      anchorEnd: Buffer.from([1]),
      quotedText: 'quote',
      createdBy: author.id,
      body: 'only comment',
    });

    const threads = await db.docComments.listThreads(documentId);
    expect(threads).toEqual([{ thread, comments: expect.arrayContaining([expect.objectContaining({ threadId: thread.id })]) }]);
  });
});
