/**
 * `PgProjectEngine.applyCiSuggestedImpactsPaths` (SDD-021 "Reconciliacion de impacts_paths desde CI",
 * WO-429): a narrow, unconditional direct write to `published_raw`, deliberately bypassing
 * `writeGeneratedFields`'s `isServerManagedField` split (`impacts_paths` is normally human-authorable,
 * so that split would incorrectly forbid this too if reused here).
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

const BLUEPRINT_ID = 'SDD-001';
const BLUEPRINT_TEMPLATE = `---\nid: ${BLUEPRINT_ID}\ntype: SDD\ntitle: "Example blueprint"\narchitects: ["FR-001"]\nimpacts_paths: ["packages/core/tests"]\n---\n\n## Contexto\n`;
const FEATURE_TEMPLATE = `---\nid: FR-001\ntype: FR\ntitle: "Example feature"\n---\n\n## Solicitud\n`;

describe('PgProjectEngine.applyCiSuggestedImpactsPaths (WO-429)', () => {
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

  async function makeEngine(): Promise<{ engine: PgProjectEngine; orgId: string; projectId: string }> {
    const org = await createOrganizationFixture(pg);
    const fixture = await createProjectFixture(pg, { orgId: org.id });
    const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
    if (!project) throw new Error('project fixture not found');
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
    await store.clear();
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), hashAlgoVersion: 1, store });
    return { engine, orgId: org.id, projectId: project.id };
  }

  async function seedPublishedBlueprint(orgId: string, projectId: string): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001-example.md', 'collab', 'published', $3)`,
      [orgId, projectId, FEATURE_TEMPLATE],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'SDD', 'Example blueprint', 'docs/sdd/SDD-001-example.md', 'collab', 'published', $4)`,
      [orgId, projectId, BLUEPRINT_ID, BLUEPRINT_TEMPLATE],
    );
  }

  test('replaces impacts_paths in published_raw and freezes a new engine_write version', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedPublishedBlueprint(orgId, projectId);

    const parsed = await engine.applyCiSuggestedImpactsPaths(BLUEPRINT_ID, ['packages/core/tests/**']);
    expect(parsed.impactsPaths).toEqual(['packages/core/tests/**']);

    const { rows } = await pg.ownerPool.query(`SELECT published_raw FROM "documents" WHERE project_id = $1 AND doc_id = $2`, [projectId, BLUEPRINT_ID]);
    expect(rows[0].published_raw).toContain('impacts_paths: ["packages/core/tests/**"]');

    const { rows: versionRows } = await pg.ownerPool.query(
      `SELECT reason FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE d.project_id = $1 AND d.doc_id = $2 ORDER BY version_no`,
      [projectId, BLUEPRINT_ID],
    );
    // The raw-SQL fixture (unlike a real createDraft/publish flow) never inserts a version 1 row, so
    // this is the only version this blueprint has.
    expect(versionRows.map((r: { reason: string }) => r.reason)).toEqual(['engine_write']);
  });

  test('marks the graph dirty, running the post-commit projection (graph_version advances)', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedPublishedBlueprint(orgId, projectId);
    const before = await pg.ownerPool.query(`SELECT graph_version FROM "projects" WHERE id = $1`, [projectId]).then((r) => r.rows[0]);

    await engine.applyCiSuggestedImpactsPaths(BLUEPRINT_ID, ['packages/core/tests/**']);

    // `withTx`'s own post-commit step already ran the projection by the time this resolves (the same
    // reason `graph_dirty` is back to `false` here, not `true` -- the dirty flag this write set inside
    // its own transaction was already cleared by that projection completing successfully).
    const after = await pg.ownerPool.query(`SELECT graph_dirty, graph_version FROM "projects" WHERE id = $1`, [projectId]).then((r) => r.rows[0]);
    expect(after.graph_dirty).toBe(false);
    expect(Number(after.graph_version)).toBeGreaterThan(Number(before.graph_version));
  });

  test('throws for a document with no published content', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
       VALUES ($1, $2, $3, 'SDD', 'Draft blueprint', 'docs/sdd/SDD-002-draft.md', 'collab', 'draft')`,
      [orgId, projectId, 'SDD-002'],
    );

    await expect(engine.applyCiSuggestedImpactsPaths('SDD-002', ['x'])).rejects.toThrow('has no published content');
  });
});
