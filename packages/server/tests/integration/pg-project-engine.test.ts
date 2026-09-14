/**
 * `PgProjectEngine` (SDD-007 "PgProjectEngine"; WO-132) against real Postgres (5433) and Neo4j (7688)
 * test instances: `scan()` (published docs + every doc_id in any workflow state + `id_counters`),
 * `transaction()` (advisory lock serializing concurrent writers, no duplicate ids), document writes and
 * `readCommit` (`trust = 'baseline'` only).
 */
import { Neo4jGraphDatabase, type GraphStore } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

const FB_TEMPLATE = (id: string, title: string): string => `---
id: ${id}
type: FB
title: "${title}"
status: new
source: other
informs: []
---

## Detalle

${title}
`;

describe('PgProjectEngine (WO-132)', () => {
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
    const engine = createPgProjectEngine({
      pool: pg.appPool,
      orgId: org.id,
      projectId: project.id,
      settings: buildProjectSettings(project),
      store,
    });
    return { engine, orgId: org.id, projectId: project.id, store };
  }

  test('scan() starts empty for a fresh project', async () => {
    const { engine } = await makeEngine();
    const scan = await engine.scan();
    expect(scan.docs).toEqual([]);
    expect(scan.errors).toEqual([]);
    expect(scan.ids).toEqual([]);
  });

  test('createDocument publishes a generated document immediately and scan() surfaces it', async () => {
    const { engine } = await makeEngine();
    await engine.transaction(async (ops) => {
      await ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First feedback'));
    });

    const scan = await engine.scan();
    expect(scan.ids).toContain('FB-001');
    expect(scan.docs).toHaveLength(1);
    expect(scan.docs[0]?.node.id).toBe('FB-001');
    expect(scan.docs[0]?.node.status).toBe('new');
  });

  test('createDocument rejects a duplicate id', async () => {
    const { engine } = await makeEngine();
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First')));
    await expect(engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-again.md', FB_TEMPLATE('FB-001', 'Again')))).rejects.toThrow(/already exists/);
  });

  test("scan().ids includes a draft's doc_id (not yet published) so id allocation never collides with an open draft", async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
       VALUES ($1, $2, 'FR-001', 'FR', 'Draft feature request', 'docs/fr/FR-001-draft.md', 'collab', 'draft')`,
      [orgId, projectId],
    );

    const scan = await engine.scan();
    expect(scan.ids).toContain('FR-001');
    // Never parsed/returned as a full doc: PgProjectEngine.scan() only exposes published raw content.
    expect(scan.docs.find((d) => d.node.id === 'FR-001')).toBeUndefined();
  });

  test("scan().ids reserves a kind's id_counters.last_seq even with no matching document row", async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await pg.ownerPool.query(`INSERT INTO "id_counters" (project_id, org_id, kind, last_seq) VALUES ($1, $2, 'FB', 7)`, [projectId, orgId]);

    const scan = await engine.scan();
    expect(scan.ids).toContain('FB-007');
  });

  test('updateDocument rewrites frontmatter fields in place and freezes a new engine_write version', async () => {
    const { engine, projectId } = await makeEngine();
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First feedback')));

    await engine.transaction((ops) => ops.updateDocument('FB-001', { status: 'triaged' }));

    const scan = await engine.scan();
    expect(scan.docs[0]?.node.status).toBe('triaged');

    const [row] = await pg.ownerPool
      .query(`SELECT count(*)::int AS count FROM "document_versions" dv JOIN "documents" d ON d.id = dv.document_id WHERE d.project_id = $1 AND d.doc_id = 'FB-001'`, [projectId])
      .then((r) => r.rows);
    expect(row.count).toBe(2);
  });

  test('replaceDocument keeps the id immutable', async () => {
    const { engine } = await makeEngine();
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First feedback')));
    await expect(engine.transaction((ops) => ops.replaceDocument('FB-001', FB_TEMPLATE('FB-002', 'Wrong id')))).rejects.toThrow(/must keep id/);
  });

  test('readCommit only resolves a commit reported with trust=baseline', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    const sha = '0123456789abcdef0123456789abcdef01234567';
    await pg.ownerPool.query(
      `INSERT INTO "commits" (project_id, sha, org_id, trust, author, date, subject) VALUES ($1, $2, $3, 'preview', 'a', now(), 'preview commit')`,
      [projectId, sha, orgId],
    );
    const previewOnly = await engine.transaction((ops) => ops.readCommit(sha));
    expect(previewOnly).toBeNull();

    await pg.ownerPool.query(`UPDATE "commits" SET trust = 'baseline' WHERE project_id = $1 AND sha = $2`, [projectId, sha]);
    const baselineNow = await engine.transaction((ops) => ops.readCommit(sha));
    expect(baselineNow?.sha).toBe(sha);
    expect(baselineNow?.subject).toBe('preview commit');
  });

  test('readCommit answers null for an unknown sha', async () => {
    const { engine } = await makeEngine();
    const result = await engine.transaction((ops) => ops.readCommit('abc1234'));
    expect(result).toBeNull();
  });

  test('transaction() serializes concurrent writers for the same project without duplicate or lost ids', async () => {
    const { engine } = await makeEngine();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        engine.transaction((ops) => ops.createDocument(`docs/feedback/FB-concurrent-${i}.md`, FB_TEMPLATE(`FB-${String(i + 1).padStart(3, '0')}`, `Feedback ${i}`))),
      ),
    );
    const ids = results.map((d) => d.node.id);
    expect(new Set(ids).size).toBe(5);

    const scan = await engine.scan();
    expect(scan.errors).toEqual([]);
    expect(scan.docs).toHaveLength(5);
  });

  test('refresh() and inspect() report the current published state without throwing', async () => {
    const { engine } = await makeEngine();
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First feedback')));

    const inspected = await engine.inspect();
    expect(inspected.documents).toBe(1);
    expect(inspected.baselineWritten).toBe(false);

    const refreshed = await engine.refresh();
    expect(refreshed.documents).toBe(1);
    expect(refreshed.baselineWritten).toBe(true);
  });

  test('acknowledge("all") writes a baseline row and returns a fresh refresh report', async () => {
    const { engine, projectId } = await makeEngine();
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First feedback')));

    const report = await engine.acknowledge('all');
    expect(report.documents).toBe(1);

    const [row] = await pg.ownerPool.query(`SELECT baseline FROM "project_baselines" WHERE project_id = $1`, [projectId]).then((r) => r.rows);
    expect(row.baseline.docs['FB-001']).toBeDefined();
  });

  test('lastReport() and recover() are safe no-ops for this WO', async () => {
    const { engine } = await makeEngine();
    expect(await engine.lastReport()).toBeNull();
    expect(await engine.recover()).toEqual({ recovered: false, warnings: [] });
  });

  test('every write marks the project graph dirty and bumps graph_version (WO-133 will project it)', async () => {
    const { engine, projectId } = await makeEngine();
    const before = await pg.ownerPool.query(`SELECT graph_version, graph_dirty FROM "projects" WHERE id = $1`, [projectId]).then((r) => r.rows[0]);
    expect(before.graph_dirty).toBe(false);

    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First feedback')));

    const after = await pg.ownerPool.query(`SELECT graph_version, graph_dirty FROM "projects" WHERE id = $1`, [projectId]).then((r) => r.rows[0]);
    expect(after.graph_dirty).toBe(true);
    expect(Number(after.graph_version)).toBeGreaterThan(Number(before.graph_version));
  });
});
