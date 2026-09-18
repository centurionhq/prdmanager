/**
 * WO-250 — `PgProjectEngine.updateDocument` against an `origin: 'collab'` document now splits
 * server-managed fields (`closeFeature`'s `status`/`closed_at`/`closed_by`) from genuinely Y.Doc-editable
 * ones (`createFeatureRequest`'s `informs` link-back, covered by `pg-project-engine-pending-patch.test.ts`,
 * unchanged). Server-managed fields are written straight to `published_raw` (`reason: 'engine_write'`,
 * exactly like a `generated`-origin document), never queued in `pending_editable_patch` — this is what
 * makes `closeFeature` visible to `scan()`/drift/graph/MCP immediately, with no dependency on anyone ever
 * opening the document's live editor (the CRITICAL regression this WO fixes: previously `closeFeature`
 * returned success and audited `feature.closed` while `scan()` kept reporting the feature as still open
 * forever, unless someone happened to open its editor).
 */
import { closeFeature, closureReadiness, createFeatureRequest, Neo4jGraphDatabase, parseDocument, type GraphStore } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

describe('PgProjectEngine server-managed collab-field writes (WO-250)', () => {
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
    // Deliberately no `hocuspocus` option: proves the `published_raw` write (the CRITICAL part of this
    // WO) needs no collab server/live editor involvement whatsoever, not even the machinery a real editor
    // would use.
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), store });
    return { engine, orgId: org.id, projectId: project.id, store };
  }

  async function seedDocument(orgId: string, projectId: string, docId: string, kind: string, sourcePath: string, content: string, origin: 'collab' | 'generated' = 'collab'): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8)`,
      [orgId, projectId, docId, kind, docId, sourcePath, origin, content],
    );
  }

  async function readDocumentRow(projectId: string, docId: string) {
    const { rows } = await pg.ownerPool.query(`SELECT published_raw, pending_editable_patch, graph_dirty FROM "documents" d JOIN "projects" p ON p.id = d.project_id WHERE d.project_id = $1 AND d.doc_id = $2`, [
      projectId,
      docId,
    ]);
    return rows[0];
  }

  /** A fully lifecycle-clean project (mirrors `close-feature.test.ts`'s own fixture): an approved,
   * justified Feature architected by a well-formed Blueprint with one done, current Work Order
   * implementing it — everything `closureReadiness` requires before `closeFeature` will even attempt the
   * write this WO fixes. */
  async function seedReadyFeature(orgId: string, projectId: string): Promise<void> {
    await seedDocument(orgId, projectId, 'ART-001', 'ART', 'docs/artifacts/ART-001.md', '---\nid: ART-001\ntype: ART\ntitle: "Customer call"\nsource: call\nroot: true\n---\n\n## Contexto\n');
    await seedDocument(
      orgId,
      projectId,
      'BC-001',
      'BC',
      'docs/business-case/BC-001.md',
      '---\nid: BC-001\ntype: BC\ntitle: "Business case"\nstatus: approved\njustified_by: ["ART-001"]\n---\n\n## Problema\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n',
    );
    await seedDocument(
      orgId,
      projectId,
      'PRD-001',
      'PRD',
      'docs/prd/PRD-001.md',
      '---\nid: PRD-001\ntype: PRD\ntitle: "Example feature"\nstatus: approved\njustified_by: ["BC-001"]\n---\n\n## Resumen\n',
    );
    const blueprintContent = '---\nid: SDD-001\ntype: SDD\ntitle: "Example design"\nstatus: active\narchitects: ["PRD-001"]\nimpacts_paths: ["src/a.ts"]\n---\n\n## Tareas\n\n- [x] Do it\n';
    await seedDocument(orgId, projectId, 'SDD-001', 'SDD', 'docs/sdd/SDD-001.md', blueprintContent);
    const parsedBlueprint = parseDocument(blueprintContent, 'docs/sdd/SDD-001.md');
    if (!parsedBlueprint?.ok) throw new Error('fixture blueprint failed to parse');
    const blueprintHash = parsedBlueprint.doc.node.contentHash;
    const woContent = `---\nid: WO-001\ntype: WO\ntitle: "Do it"\nstatus: done\nimplements: ["SDD-001"]\nblueprint_hashes: {"SDD-001": "${blueprintHash}"}\nsource_task: "abc1234567890def"\n---\n\nDo it.\n`;
    await seedDocument(orgId, projectId, 'WO-001', 'WO', 'docs/work-orders/WO-001.md', woContent, 'generated');
  }

  test('closeFeature writes status/closed_at/closed_by straight to published_raw, visible in scan() immediately, with no editor ever opened', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedReadyFeature(orgId, projectId);

    const readiness = await closureReadiness(engine, 'PRD-001');
    expect(readiness.ready).toBe(true);

    const result = await closeFeature(engine, 'PRD-001', { by: 'dev:tester', now: new Date('2026-09-15T00:00:00.000Z') });

    const row = await readDocumentRow(projectId, 'PRD-001');
    // `setFrontmatterFields` (the same rendering path any `generated`-origin write already uses)
    // re-renders every set field as JSON, hence the quotes.
    expect(row.published_raw).toContain('status: "closed"');
    expect(row.published_raw).toContain(`closed_at: ${JSON.stringify(result.closedAt)}`);
    expect(row.published_raw).toContain('closed_by: "dev:tester"');
    // Nothing left pending: this used to be exactly where WO-139's placeholder incorrectly parked the
    // whole write (see this file's own module doc comment).
    expect(row.pending_editable_patch).toBeNull();

    // The literal regression this WO fixes: `scan()` (what drift/graph/MCP all read) reflects the closure
    // immediately — never dependent on anyone opening PRD-001's collab editor.
    const scan = await engine.scan();
    const feature = scan.docs.find((d) => d.node.id === 'PRD-001');
    expect(feature?.node.status).toBe('closed');
  });

  test('a rolled-back closeFeature-style write never leaves a partial published_raw change behind', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedReadyFeature(orgId, projectId);
    const before = await readDocumentRow(projectId, 'PRD-001');

    await expect(
      engine.transaction(async (ops) => {
        await ops.updateDocument('PRD-001', { status: 'closed', closed_at: '2026-09-15T00:00:00.000Z', closed_by: 'dev:tester' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await readDocumentRow(projectId, 'PRD-001');
    expect(after.published_raw).toBe(before.published_raw);
    expect(after.pending_editable_patch).toBeNull();
  });

  test('a single updateDocument call mixing a server-managed field and a genuinely editable one splits correctly', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocument(orgId, projectId, 'FB-001', 'FB', 'docs/feedback/FB-001.md', '---\nid: FB-001\ntype: FB\ntitle: "Customer feedback"\nstatus: new\nsource: other\ninforms: []\n---\n\n## Feedback\n');

    // Not a real caller today (closeFeature/createFeatureRequest each only ever pass one kind or the
    // other) but proves `writeGeneratedFields` handles a hypothetical mixed call correctly either way.
    await engine.transaction((ops) => ops.updateDocument('FB-001', { closed_at: '2026-09-15T00:00:00.000Z', informs: ['FR-001'] }));

    const row = await readDocumentRow(projectId, 'FB-001');
    expect(row.published_raw).toContain('closed_at: "2026-09-15T00:00:00.000Z"');
    expect(row.pending_editable_patch).toEqual({ informs: ['FR-001'] });
  });

  test("createFeatureRequest's informs link-back is unaffected: still a genuinely editable field, still queued", async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocument(orgId, projectId, 'PRD-001', 'PRD', 'docs/prd/PRD-001.md', '---\nid: PRD-001\ntype: PRD\ntitle: "Parent feature"\nstatus: approved\n---\n\n## Resumen\n');
    await seedDocument(orgId, projectId, 'FB-001', 'FB', 'docs/feedback/FB-001.md', '---\nid: FB-001\ntype: FB\ntitle: "Customer feedback"\nstatus: new\nsource: other\ninforms: []\n---\n\n## Feedback\n');

    await createFeatureRequest(engine, { title: 'Add dark mode', description: 'Customers want a dark theme', parentId: 'PRD-001', feedbackId: 'FB-001' });

    const row = await readDocumentRow(projectId, 'FB-001');
    expect(row.published_raw).toContain('informs: []'); // unchanged: still not a server-managed field
    expect(row.pending_editable_patch).toEqual({ informs: ['FR-001'] });
  });
});
