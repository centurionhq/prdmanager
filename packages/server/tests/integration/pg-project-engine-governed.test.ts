/**
 * `PgProjectEngine.buildDriftInput` reading real governed code state from `project_code_refs` (SDD-012
 * "Centurion Factory conectado al backend SaaS", WO-334) — the fix for the long-standing bug where
 * `buildDriftInput` always returned `governed: new Map()`, so code drift (`code_changed`) was never
 * detected in SaaS and `systemIntegrity` stayed 0/0 forever.
 */
import { randomUUID } from 'node:crypto';
import { DatabaseBusyError, generateWorkOrders, getMetrics, Neo4jGraphDatabase, sha256, type GraphStore } from '@prdm/core';
import { createPool, createTenantDb, replaceProjectCodeRefs } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, testPgConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

const BLUEPRINT_ID = 'SDD-001';
const REF_PATH = 'src/foo.ts';
const REF_KEY = REF_PATH;

const FEATURE_TEMPLATE = `---
id: FR-001
type: FR
title: "Example feature"
---

## Solicitud
`;

const BLUEPRINT_TEMPLATE = `---
id: ${BLUEPRINT_ID}
type: SDD
title: "Example blueprint"
architects: ["FR-001"]
impacts_paths: ["${REF_PATH}"]
---

## Contexto
`;

function impactsPathsHash(paths: readonly string[]): string {
  return sha256(JSON.stringify([...paths].sort()));
}

describe('PgProjectEngine.buildDriftInput reads project_code_refs (WO-334)', () => {
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

  async function makeEngine(): Promise<{ engine: PgProjectEngine; orgId: string; projectId: string; graphProjectId: string; store: GraphStore }> {
    const org = await createOrganizationFixture(pg);
    const fixture = await createProjectFixture(pg, { orgId: org.id });
    const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
    if (!project) throw new Error('project fixture not found');
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
    await store.clear();
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), hashAlgoVersion: 1, store });
    return { engine, orgId: org.id, projectId: project.id, graphProjectId: project.graphProjectId, store };
  }

  async function seedDocs(orgId: string, projectId: string): Promise<void> {
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
    // Keeps reconcileByHash from excluding SDD-001 as stale, isolating this suite's own concern.
    await pg.ownerPool.query(`INSERT INTO "project_code_state" (project_id, org_id, impacts_hashes) VALUES ($1, $2, $3::jsonb)`, [
      projectId,
      orgId,
      JSON.stringify({ [BLUEPRINT_ID]: impactsPathsHash([REF_PATH]) }),
    ]);
    // Raw SQL document inserts (unlike PgProjectEngine's own createDocument/writeGeneratedContent)
    // never mark graph_dirty; done by hand here so refresh()'s post-commit projection actually runs,
    // which (d)/(e) below need.
    await pg.ownerPool.query(`UPDATE "projects" SET graph_dirty = true WHERE id = $1`, [projectId]);
  }

  async function seedRef(orgId: string, projectId: string, hash: string, headSha = 'a'.repeat(40)): Promise<void> {
    await replaceProjectCodeRefs(pg.appPool, {
      projectId,
      orgId,
      blueprintId: BLUEPRINT_ID,
      reportId: randomUUID(),
      headSha,
      refs: [{ refKey: REF_KEY, path: REF_PATH, symbol: null, hash, hashAlgoVersion: 1 }],
    });
  }

  async function readBaseline(projectId: string): Promise<{ version: number; docs: Record<string, string>; governs: Record<string, Record<string, string | null>> }> {
    const [row] = await pg.ownerPool.query(`SELECT baseline FROM "project_baselines" WHERE project_id = $1`, [projectId]).then((r) => r.rows);
    return row.baseline;
  }

  test('(a) baseline.governs accumulates normally between two syncs without new refs', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocs(orgId, projectId);
    await seedRef(orgId, projectId, 'b'.repeat(64));

    // Unrelated lifecycle rules (SDD-002 §3, PRD-002) also flag this deliberately minimal fixture as
    // blocking (FR-001 has no justification) — irrelevant to this WO's own concern, so `hasBlockingIssues`
    // is deliberately not asserted on here (same note as pg-project-engine-refresh.test.ts).
    await engine.refresh();
    const baselineAfterFirst = await readBaseline(projectId);
    expect(baselineAfterFirst.governs[BLUEPRINT_ID]).toEqual({ [REF_KEY]: 'b'.repeat(64) });

    await engine.refresh();
    const baselineAfterSecond = await readBaseline(projectId);
    expect(baselineAfterSecond.governs[BLUEPRINT_ID]).toEqual({ [REF_KEY]: 'b'.repeat(64) });
  });

  test('(b) two baseline reports with a different hash for the same ref produce a code_changed issue', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocs(orgId, projectId);
    await seedRef(orgId, projectId, 'b'.repeat(64));
    await engine.refresh();

    await seedRef(orgId, projectId, 'c'.repeat(64));
    const report = await engine.refresh();

    const issue = report.issues.find((i) => i.kind === 'code_out_of_sync');
    expect(issue).toMatchObject({ nodeId: BLUEPRINT_ID, target: REF_KEY, severity: 'error' });
    expect(report.governed.find((g) => g.key === REF_KEY)?.reason).toBe('code_changed');
  });

  test('(c) a blueprint with no changes between syncs keeps its baseline intact', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedDocs(orgId, projectId);
    await seedRef(orgId, projectId, 'b'.repeat(64));

    await engine.refresh();
    await engine.refresh();
    const report = await engine.refresh();

    expect(report.issues.some((i) => i.kind === 'code_out_of_sync')).toBe(false);
    const baseline = await readBaseline(projectId);
    expect(baseline.governs[BLUEPRINT_ID]).toEqual({ [REF_KEY]: 'b'.repeat(64) });
  });

  test('(d) a baseline report produces a real CodeRef node and a GOVERNED_BY relationship in Neo4j', async () => {
    const { engine, orgId, projectId, store } = await makeEngine();
    await seedDocs(orgId, projectId);
    await seedRef(orgId, projectId, 'b'.repeat(64));

    await engine.refresh();

    const detail = await store.getNode(BLUEPRINT_ID);
    const governedByLink = detail?.links.find((l) => l.type === 'GOVERNED_BY' && l.direction === 'in');
    expect(governedByLink, 'expected a CodeRef -[:GOVERNED_BY]-> Blueprint relationship').toBeDefined();
    expect(governedByLink?.title).toBe(REF_KEY);
  });

  test('(e) computeMetrics/systemIntegrity is no longer 0/0 once a baseline report exists', async () => {
    const { engine, orgId, projectId, store } = await makeEngine();
    await seedDocs(orgId, projectId);
    await seedRef(orgId, projectId, 'b'.repeat(64));

    await engine.refresh();

    const metrics = await getMetrics(store);
    expect(metrics.systemIntegrity.governedTotal).toBeGreaterThan(0);
    expect(metrics.systemIntegrity.syncedPercent).not.toBeNull();
  });

  const TASKS_BLUEPRINT = `---
id: ${BLUEPRINT_ID}
type: SDD
title: "Example blueprint"
architects: ["FR-001"]
impacts_paths: ["src/a.ts"]
---

## Tareas

- [ ] Primera tarea
`;

  async function seedBlueprintWithTasks(orgId: string, projectId: string): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001-example.md', 'collab', 'published', $3)`,
      [orgId, projectId, FEATURE_TEMPLATE],
    );
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'SDD', 'Example blueprint', 'docs/sdd/SDD-001-example.md', 'collab', 'published', $4)`,
      [orgId, projectId, BLUEPRINT_ID, TASKS_BLUEPRINT],
    );
    await pg.ownerPool.query(`UPDATE "projects" SET graph_dirty = true WHERE id = $1`, [projectId]);
  }

  async function readGraphDirty(projectId: string): Promise<boolean> {
    const { rows } = await pg.ownerPool.query(`SELECT graph_dirty FROM "projects" WHERE id = $1`, [projectId]);
    return rows[0].graph_dirty as boolean;
  }

  async function countDoc(projectId: string, docId: string): Promise<number> {
    const { rows } = await pg.ownerPool.query(`SELECT count(*)::int AS n FROM "documents" WHERE project_id = $1 AND doc_id = $2`, [projectId, docId]);
    return rows[0].n as number;
  }

  test('(f) a pool with no free connection surfaces DatabaseBusyError quickly instead of hanging (WO-646)', async () => {
    const { orgId, projectId, store } = await makeEngine();
    const project = await createTenantDb(pg.appPool).forOrg(orgId).projects.findById(projectId);
    if (!project) throw new Error('project fixture not found');
    const pool = createPool({ connectionString: testPgConfig().appUrl, maxConnections: 1, connectionTimeoutMillis: 250 });
    const engine = createPgProjectEngine({ pool, orgId, projectId, settings: buildProjectSettings(project), hashAlgoVersion: 1, store });
    const held = await pool.connect();
    try {
      const startedAt = Date.now();
      await expect(engine.lastReport()).rejects.toBeInstanceOf(DatabaseBusyError);
      expect(Date.now() - startedAt).toBeLessThan(2000);
    } finally {
      held.release();
      await pool.end();
    }
  });

  test('(g) generateWorkOrders with deferProjection commits the write but leaves the graph for recover() (WO-646)', async () => {
    const { engine, orgId, projectId, store } = await makeEngine();
    await seedBlueprintWithTasks(orgId, projectId);

    const result = await generateWorkOrders(engine, BLUEPRINT_ID, { deferProjection: true });

    expect(result.created).toHaveLength(1);
    const woId = result.created[0]!.id;
    expect(await countDoc(projectId, woId)).toBe(1);
    expect(await readGraphDirty(projectId)).toBe(true);
    expect(await store.getNode(woId)).toBeFalsy();

    expect((await engine.recover()).recovered).toBe(true);
    expect(await readGraphDirty(projectId)).toBe(false);
    expect(await store.getNode(woId)).toBeTruthy();
    expect((await engine.recover()).recovered).toBe(false);
  });

  test('(h) generateWorkOrders without options still projects inside the request (WO-646)', async () => {
    const { engine, orgId, projectId, store } = await makeEngine();
    await seedBlueprintWithTasks(orgId, projectId);

    const result = await generateWorkOrders(engine, BLUEPRINT_ID);

    expect(await readGraphDirty(projectId)).toBe(false);
    expect(await store.getNode(result.created[0]!.id)).toBeTruthy();
  });
});
