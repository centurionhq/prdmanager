/**
 * `importDocuments` (`packages/db/src/import-repository.ts`, WO-260 performance review): the original
 * implementation ran one sequential `await`ed `INSERT documents` / `INSERT document_versions` / `UPDATE
 * documents` per imported document (plus one more per distinct `commits` sha), all inside a single
 * `withTenantTx` transaction holding one connection from the shared (10-connection) pool for the whole
 * import — for this very repo's own ~260 real documents, hundreds of sequential round trips on one
 * connection. Rewritten to batch every one of those into a fixed number of multi-row statements
 * regardless of document count.
 *
 * The first test below is the WO-260 acceptance criterion itself: the number of real Postgres queries
 * issued must not scale with the number of documents (no wall-clock timing assertion, per this repo's
 * no-timing-assertions policy — real `pg.Client.prototype.query` calls are counted directly, the same
 * `vi.spyOn` shape `./truncate-all-lock-order.test.ts` already uses, just on the per-connection `Client`
 * rather than the `Pool`: drizzle's `db.transaction()` checks out one dedicated `pg.Client` for the whole
 * transaction and issues every statement through it, never through `Pool.prototype.query`).
 *
 * The second test locks down the batched rewrite's actual correctness: document/version/commit rows,
 * `publishedVersionId` wiring, input order preservation, and deduped `commits` shas — the same
 * behavior/semantics the old per-row loop had, now produced by multi-row statements instead.
 */
import { Client } from 'pg';
import { importDocuments, type ImportDocumentInput } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

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

function prdInput(seq: number): ImportDocumentInput {
  const docId = `PRD-${String(seq).padStart(3, '0')}`;
  return {
    kind: 'PRD',
    docId,
    title: `Imported doc ${seq}`,
    sourcePath: `docs/prd/${docId}.md`,
    renderedMarkdown: `---\nid: ${docId}\ntype: PRD\ntitle: "Imported doc ${seq}"\n---\nBody for ${docId}.\n`,
    frontmatter: { id: docId, type: 'PRD' },
    contentHash: String(seq).padStart(64, '0'),
  };
}

/** Counts every real query issued on the underlying `pg.Client` while `importDocuments` runs — not
 * `Pool.prototype.query`, which a checked-out transaction client never goes back through. */
async function countQueriesDuringImport(orgId: string, projectId: string, documentCount: number): Promise<number> {
  const querySpy = vi.spyOn(Client.prototype, 'query');
  const before = querySpy.mock.calls.length;
  await importDocuments(pg.appPool, {
    orgId,
    projectId,
    documents: Array.from({ length: documentCount }, (_, i) => prdInput(i + 1)),
  });
  const issued = querySpy.mock.calls.length - before;
  querySpy.mockRestore();
  return issued;
}

describe('importDocuments batches its writes into a fixed number of statements (WO-260)', () => {
  test('the number of queries issued does not scale with the number of documents', async () => {
    const orgSmall = await createOrganizationFixture(pg);
    const projectSmall = await createProjectFixture(pg, { orgId: orgSmall.id });
    const orgLarge = await createOrganizationFixture(pg);
    const projectLarge = await createProjectFixture(pg, { orgId: orgLarge.id });

    const queriesForFive = await countQueriesDuringImport(orgSmall.id, projectSmall.id, 5);
    const queriesForFifty = await countQueriesDuringImport(orgLarge.id, projectLarge.id, 50);

    // The old sequential loop issued 3 statements per document (INSERT documents, INSERT
    // document_versions, UPDATE documents) alone — 45 extra documents would have meant 135 more queries.
    // The batched rewrite issues the same fixed number of statements no matter how many documents.
    expect(queriesForFifty).toBe(queriesForFive);
    // Sanity bound so this test would still fail loudly if the fixed count itself crept up unreasonably.
    expect(queriesForFive).toBeLessThan(20);
  });

  test('importing 0 documents issues no more queries than importing 5', async () => {
    const orgEmpty = await createOrganizationFixture(pg);
    const projectEmpty = await createProjectFixture(pg, { orgId: orgEmpty.id });
    const orgFive = await createOrganizationFixture(pg);
    const projectFive = await createProjectFixture(pg, { orgId: orgFive.id });

    const queriesForZero = await countQueriesDuringImport(orgEmpty.id, projectEmpty.id, 0);
    const queriesForFive = await countQueriesDuringImport(orgFive.id, projectFive.id, 5);

    expect(queriesForZero).toBeLessThanOrEqual(queriesForFive);
  });
});

describe('importDocuments batched-write correctness (WO-260)', () => {
  function woInput(id: string, resolvedBy: string[]): ImportDocumentInput {
    return {
      kind: 'WO',
      docId: id,
      title: `Imported ${id}`,
      sourcePath: `docs/work-orders/${id}.md`,
      renderedMarkdown: `---\nid: ${id}\ntype: WO\ntitle: "Imported ${id}"\nresolved_by: [${resolvedBy.map((s) => `"${s}"`).join(', ')}]\n---\nBody for ${id}.\n`,
      frontmatter: { id, type: 'WO', resolved_by: resolvedBy },
      contentHash: 'a'.repeat(64),
    };
  }

  test('inserts every document + version, wires publishedVersionId, preserves input order, and dedupes commits shas', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const shaA = 'a'.repeat(40);
    const shaB = 'b'.repeat(40);

    const docs: ImportDocumentInput[] = [
      prdInput(3),
      prdInput(1),
      woInput('WO-001', [shaA, shaB]),
      woInput('WO-002', [shaA]), // same sha as WO-001 — commits must be deduped, not double-inserted
    ];

    const result = await importDocuments(pg.appPool, { orgId: org.id, projectId: project.id, documents: docs });

    // Result order mirrors input order (PRD-003, PRD-001, WO-001, WO-002), not insertion/DB order.
    expect(result.documents.map((d) => d.docId)).toEqual(['PRD-003', 'PRD-001', 'WO-001', 'WO-002']);
    expect(result.documents.every((d) => d.publishedVersionId !== null)).toBe(true);
    expect(result.importedCommitShas).toEqual([shaA, shaB]);

    const rows = (
      await pg.ownerPool.query<{ doc_id: string; published_version_id: string; published_content_hash: string }>(
        `SELECT doc_id, published_version_id, published_content_hash FROM documents WHERE project_id = $1 ORDER BY doc_id`,
        [project.id],
      )
    ).rows;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.published_version_id).not.toBeNull();
    }

    const versions = (
      await pg.ownerPool.query<{ doc_id: string; version_no: number; reason: string; contributors: string[] }>(
        `SELECT d.doc_id, dv.version_no, dv.reason, dv.contributors
         FROM document_versions dv JOIN documents d ON d.id = dv.document_id
         WHERE d.project_id = $1 ORDER BY d.doc_id`,
        [project.id],
      )
    ).rows;
    expect(versions).toHaveLength(4);
    for (const version of versions) {
      expect(version.version_no).toBe(1);
      expect(version.reason).toBe('import');
      expect(version.contributors).toEqual(['system:import']);
    }

    // Every documents.published_version_id actually points at that document's own version 1 row.
    const linked = (
      await pg.ownerPool.query<{ doc_id: string }>(
        `SELECT d.doc_id FROM documents d JOIN document_versions dv ON dv.id = d.published_version_id WHERE d.project_id = $1`,
        [project.id],
      )
    ).rows;
    expect(linked).toHaveLength(4);

    const commits = (await pg.ownerPool.query<{ sha: string; trust: string }>(`SELECT sha, trust FROM commits WHERE project_id = $1 ORDER BY sha`, [project.id])).rows;
    expect(commits).toEqual([
      { sha: shaA, trust: 'import' },
      { sha: shaB, trust: 'import' },
    ]);
  });

  test('importing zero documents is a no-op that still returns an empty result', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    const result = await importDocuments(pg.appPool, { orgId: org.id, projectId: project.id, documents: [] });

    expect(result).toEqual({ documents: [], importedCommitShas: [], grandfatheredImported: false, baselineImported: false });
  });
});
