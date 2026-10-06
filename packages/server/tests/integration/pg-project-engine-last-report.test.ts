/**
 * `PgProjectEngine.lastReport()` (WO-604, SDD-010): `refresh()` persists its `RefreshReport` verbatim in
 * `project_code_state.last_report`; `lastReport()` reads it back without recomputing; `inspect()` never
 * writes it.
 */
import { Neo4jGraphDatabase, type GraphStore } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

const blueprintTemplate = (id: string, impactsPaths: string[]): string => `---
id: ${id}
type: SDD
title: "Example blueprint ${id}"
architects: ["FR-001"]
impacts_paths: ${JSON.stringify(impactsPaths)}
---

## Contexto

Example.
`;

const FEATURE_TEMPLATE = `---
id: FR-001
type: FR
title: "Example feature"
---

## Solicitud
`;

describe('PgProjectEngine.lastReport() (WO-604)', () => {
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

  async function seedFeature(orgId: string, projectId: string): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, 'FR-001', 'FR', 'Example feature', 'docs/fr/FR-001-example.md', 'collab', 'published', $3)`,
      [orgId, projectId, FEATURE_TEMPLATE],
    );
  }

  async function seedBlueprint(orgId: string, projectId: string, id: string, impactsPaths: string[]): Promise<void> {
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw)
       VALUES ($1, $2, $3, 'SDD', $4, $5, 'collab', 'published', $6)`,
      [orgId, projectId, id, `Example blueprint ${id}`, `docs/sdd/${id}-example.md`, blueprintTemplate(id, impactsPaths)],
    );
  }

  test('returns null before any refresh has been persisted', async () => {
    const { engine } = await makeEngine();

    expect(await engine.lastReport()).toBeNull();
  });

  test('refresh() persists the report and lastReport() returns it verbatim', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedFeature(orgId, projectId);
    await seedBlueprint(orgId, projectId, 'SDD-001', ['src/a.ts']);

    const report = await engine.refresh();
    const stored = await engine.lastReport();

    expect(stored).not.toBeNull();
    expect(typeof stored?.hasBlockingIssues).toBe('boolean');
    expect(stored?.issues.some((i) => i.kind === 'awaiting_ci_report')).toBe(true);
    expect(stored).toEqual(report);
  });

  test('inspect() never persists a report', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedFeature(orgId, projectId);
    await seedBlueprint(orgId, projectId, 'SDD-001', ['src/a.ts']);

    await engine.inspect();

    expect(await engine.lastReport()).toBeNull();
  });

  test('a second refresh() overwrites the previously stored report', async () => {
    const { engine, orgId, projectId } = await makeEngine();
    await seedFeature(orgId, projectId);
    await seedBlueprint(orgId, projectId, 'SDD-001', ['src/a.ts']);
    const report1 = await engine.refresh();
    expect(await engine.lastReport()).toEqual(report1);

    await seedBlueprint(orgId, projectId, 'SDD-002', ['src/b.ts']);
    const report2 = await engine.refresh();
    const stored2 = await engine.lastReport();

    expect(stored2).toEqual(report2);
    expect(stored2).not.toEqual(report1);
  });
});
