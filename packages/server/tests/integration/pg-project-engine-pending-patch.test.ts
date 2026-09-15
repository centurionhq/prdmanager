/**
 * `PgProjectEngine`'s SDD-008 mechanism for engine writes to a `collab`-origin document's genuinely
 * Y.Doc-editable fields (SDD-007 "PgProjectEngine"; WO-139, narrowed by WO-250 to only cover
 * non-server-managed fields — see `pg-project-engine-server-managed-fields.test.ts` for the
 * `status`/`closed_at`/`closed_by`-style fields this file's own scope no longer includes): never a direct
 * `UPDATE` of `published_raw`/a future `working_state` — merged into `documents.pending_editable_patch`
 * instead, idempotently, and rolled back with the rest of the transaction like any other write.
 */
import { createFeatureRequest, Neo4jGraphDatabase, type GraphStore } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

describe('PgProjectEngine pending-editable-patch placeholder (WO-139)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  async function makeEngine(): Promise<{ engine: PgProjectEngine; orgId: string; projectId: string; store: GraphStore }> {
    const org = await createOrganizationFixture(pg);
    const fixture = await createProjectFixture(pg, { orgId: org.id });
    const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
    if (!project) throw new Error('project fixture not found');
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
    await store.clear();
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), store });
    return { engine, orgId: org.id, projectId: project.id, store };
  }

  async function seedCollabDocument(orgId: string, projectId: string, docId: string, kind: string, sourcePath: string, content: string): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, $4, $5, $6, 'collab', 'published', $7)`,
      [orgId, projectId, docId, kind, docId, sourcePath, content],
    );
  }

  async function readDocumentRow(projectId: string, docId: string) {
    const { rows } = await pg.ownerPool.query(`SELECT published_raw, pending_editable_patch, graph_dirty FROM "documents" d JOIN "projects" p ON p.id = d.project_id WHERE d.project_id = $1 AND d.doc_id = $2`, [
      projectId,
      docId,
    ]);
    return rows[0];
  }

  const FB_CONTENT = `---\nid: FB-001\ntype: FB\ntitle: "Customer feedback"\nstatus: new\nsource: other\ninforms: []\n---\n\n## Feedback\n`;

  test('updateDocument against a collab-origin document merges into pending_editable_patch, never published_raw', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedCollabDocument(orgId, projectId, 'FB-001', 'FB', 'docs/feedback/FB-001.md', FB_CONTENT);

    await engine.transaction((ops) => ops.updateDocument('FB-001', { informs: ['FR-001'] }));

    const row = await readDocumentRow(projectId, 'FB-001');
    expect(row.published_raw).toBe(FB_CONTENT);
    expect(row.pending_editable_patch).toEqual({ informs: ['FR-001'] });
  });

  test('repeated/overlapping writes merge idempotently (last write wins per key, others accumulate)', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedCollabDocument(orgId, projectId, 'FB-001', 'FB', 'docs/feedback/FB-001.md', FB_CONTENT);

    await engine.transaction((ops) => ops.updateDocument('FB-001', { informs: ['FR-001'] }));
    await engine.transaction((ops) => ops.updateDocument('FB-001', { informs: ['FR-001', 'FR-002'], status: 'triaged' }));

    const row = await readDocumentRow(projectId, 'FB-001');
    expect(row.pending_editable_patch).toEqual({ informs: ['FR-001', 'FR-002'], status: 'triaged' });
  });

  test('queuing a pending patch never marks the graph dirty (nothing published actually changed)', async () => {
    const { engine, projectId, orgId } = await makeEngine();
    await seedCollabDocument(orgId, projectId, 'FB-001', 'FB', 'docs/feedback/FB-001.md', FB_CONTENT);
    const before = await readDocumentRow(projectId, 'FB-001');

    await engine.transaction((ops) => ops.updateDocument('FB-001', { informs: ['FR-001'] }));

    const after = await readDocumentRow(projectId, 'FB-001');
    expect(after.graph_dirty).toBe(before.graph_dirty);
    expect(after.graph_dirty).toBe(false);
  });

  test('a rolled-back transaction never leaves a partial pending patch behind', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedCollabDocument(orgId, projectId, 'FB-001', 'FB', 'docs/feedback/FB-001.md', FB_CONTENT);

    await expect(
      engine.transaction(async (ops) => {
        await ops.updateDocument('FB-001', { informs: ['FR-001'] });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const row = await readDocumentRow(projectId, 'FB-001');
    expect(row.pending_editable_patch).toBeNull();
  });

  test('updateDocument against a generated-origin document is unaffected (direct write, as before WO-139)', async () => {
    const { engine } = await makeEngine();
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_CONTENT));
    await engine.transaction((ops) => ops.updateDocument('FB-001', { status: 'triaged' }));

    const scan = await engine.scan();
    expect(scan.docs[0]?.node.status).toBe('triaged');
  });

  test('createFeatureRequest end-to-end: the new FR is generated/published normally, but the justifying Feedback\'s informs update is only queued', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    const parentContent = `---\nid: PRD-001\ntype: PRD\ntitle: "Parent feature"\nstatus: approved\n---\n\n## Resumen\n`;
    await seedCollabDocument(orgId, projectId, 'PRD-001', 'PRD', 'docs/prd/PRD-001.md', parentContent);
    await seedCollabDocument(orgId, projectId, 'FB-001', 'FB', 'docs/feedback/FB-001.md', FB_CONTENT);

    const result = await createFeatureRequest(engine, {
      title: 'Add dark mode',
      description: 'Customers want a dark theme',
      parentId: 'PRD-001',
      feedbackId: 'FB-001',
    });

    expect(result.id).toBe('FR-001');
    const scan = await engine.scan();
    const fr = scan.docs.find((d) => d.node.id === 'FR-001');
    expect(fr).toBeDefined();

    const feedbackRow = await readDocumentRow(projectId, 'FB-001');
    expect(feedbackRow.published_raw).toBe(FB_CONTENT); // unchanged: FB-001 is collab-origin
    expect(feedbackRow.pending_editable_patch).toEqual({ informs: ['FR-001'] });
  });
});
