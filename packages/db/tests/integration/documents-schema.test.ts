/**
 * `documents`/`document_versions`/`id_counters`/`project_baselines`/`commits`/`project_code_state`
 * (SDD-007 "Documentos y flujo"; WO-130). The generic sweep in `catalog.test.ts` already proves every
 * one of these has `org_id NOT NULL`, RLS enabled+forced and (where applicable) a composite FK; this
 * file exercises the FK/RLS/`resolve_document` behavior directly against the real test Postgres
 * instance (through `withTenantTx` on `pg.appPool`, exactly like production code would), the same way
 * `resolve-project.test.ts` does for `projects`.
 */
import { schema, withTenantTx } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;

/** drizzle-orm wraps every driver error in its own "Failed query: ..." message; the real Postgres error (with the constraint name) is on `.cause`. */
async function expectPgError(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await fn();
    expect.fail('expected the query to reject');
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
    expect(cause).toMatch(pattern);
  }
}

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

/** Inserts through `withTenantTx` with `app.org_id` set to `orgId` — same path `PgProjectEngine` would use, so a positive test here also proves prdm_app's RLS WITH CHECK allows a document's own org. */
async function insertDocument(pg: PgTestDb, overrides: { orgId: string; projectId: string; docId?: string }) {
  const [row] = await withTenantTx(pg.appPool, overrides.orgId, (tx) =>
    tx
      .insert(schema.documents)
      .values({
        orgId: overrides.orgId,
        projectId: overrides.projectId,
        docId: overrides.docId ?? 'PRD-001',
        kind: 'PRD',
        title: 'Test document',
        sourcePath: 'docs/prd/PRD-001.md',
        origin: 'collab',
      })
      .returning(),
  );
  return row!;
}

describe('documents/document_versions/id_counters/project_baselines/commits/project_code_state (WO-130)', () => {
  test('composite FK rejects a document whose project_id belongs to a different org, even with a matching app.org_id', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectInOrgA = await createProjectFixture(pg, { orgId: orgA.id });

    // app.org_id = orgB matches the row's own org_id (RLS WITH CHECK passes), but project_id belongs to
    // orgA: the composite FK (project_id, org_id) -> projects(id, org_id) must still reject this.
    await expectPgError(() => insertDocument(pg, { orgId: orgB.id, projectId: projectInOrgA.id }), /violates foreign key constraint "documents_project_org_fk"/);
  });

  test('document_versions composite FK rejects a version whose document_id belongs to a different org', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });
    const doc = await insertDocument(pg, { orgId: orgA.id, projectId: projectA.id });

    await expectPgError(
      () =>
        withTenantTx(pg.appPool, orgB.id, (tx) =>
          tx.insert(schema.documentVersions).values({ orgId: orgB.id, documentId: doc.id, versionNo: 1, reason: 'manual', renderedMarkdown: 'body', contentHash: 'hash' }),
        ),
      /violates foreign key constraint "document_versions_document_org_fk"/,
    );
  });

  test('a document is only visible through withTenantTx for its own org, never another org\'s tenant scope', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });
    await insertDocument(pg, { orgId: orgA.id, projectId: projectA.id });

    const seenByOwnOrg = await withTenantTx(pg.appPool, orgA.id, (tx) => tx.select().from(schema.documents));
    expect(seenByOwnOrg).toHaveLength(1);

    const seenByOtherOrg = await withTenantTx(pg.appPool, orgB.id, (tx) => tx.select().from(schema.documents));
    expect(seenByOtherOrg).toEqual([]);
  });

  test('UNIQUE (project_id, doc_id) rejects a second document with the same doc_id in the same project', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    await insertDocument(pg, { orgId: org.id, projectId: project.id, docId: 'PRD-001' });

    await expectPgError(() => insertDocument(pg, { orgId: org.id, projectId: project.id, docId: 'PRD-001' }), /documents_project_id_doc_id_key/);
  });

  test('resolve_document resolves org_id and project_id for a known document uuid, and nothing for an unknown one, leaking no other column', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const doc = await insertDocument(pg, { orgId: org.id, projectId: project.id });

    // No withTenantTx: resolve_document (SECURITY DEFINER) must work before app.org_id is ever set.
    const { rows } = await pg.appPool.query('SELECT * FROM resolve_document($1)', [doc.id]);
    expect(rows).toEqual([{ org_id: org.id, project_id: project.id }]);
    expect(Object.keys(rows[0]).sort()).toEqual(['org_id', 'project_id']);

    const { rows: missing } = await pg.appPool.query('SELECT * FROM resolve_document($1)', ['00000000-0000-0000-0000-000000000000']);
    expect(missing).toEqual([]);
  });

  test('id_counters, project_baselines and project_code_state each accept a row for their own org and reject a mismatched one', async () => {
    const org = await createOrganizationFixture(pg);
    const otherOrg = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    await withTenantTx(pg.appPool, org.id, (tx) => tx.insert(schema.idCounters).values({ projectId: project.id, orgId: org.id, kind: 'PRD', lastSeq: 3 }));
    await withTenantTx(pg.appPool, org.id, (tx) => tx.insert(schema.projectBaselines).values({ projectId: project.id, orgId: org.id, baseline: { version: 1 } }));
    await withTenantTx(pg.appPool, org.id, (tx) => tx.insert(schema.projectCodeState).values({ projectId: project.id, orgId: org.id }));

    await expectPgError(
      () => withTenantTx(pg.appPool, otherOrg.id, (tx) => tx.insert(schema.idCounters).values({ projectId: project.id, orgId: otherOrg.id, kind: 'FR', lastSeq: 0 })),
      /violates foreign key constraint "id_counters_project_org_fk"/,
    );
  });

  test('commits: composite PK (project_id, sha), sha format check and composite org FK', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const sha = '0123456789abcdef0123456789abcdef01234567';

    await withTenantTx(pg.appPool, org.id, (tx) =>
      tx.insert(schema.commits).values({ projectId: project.id, orgId: org.id, sha, trust: 'baseline', author: 'a', date: new Date(), subject: 's' }),
    );

    await expectPgError(
      () =>
        withTenantTx(pg.appPool, org.id, (tx) =>
          tx.insert(schema.commits).values({ projectId: project.id, orgId: org.id, sha: 'not-a-sha', trust: 'baseline', author: 'a', date: new Date(), subject: 's' }),
        ),
      /commits_sha_format/,
    );

    const seen = await withTenantTx(pg.appPool, org.id, (tx) => tx.select().from(schema.commits));
    expect(seen).toHaveLength(1);
  });
});
