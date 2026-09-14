/**
 * `PgProjectEngine`'s outbox projection (SDD-007 "PgProjectEngine"; WO-133): every internal write only
 * touches Postgres plus `graph_version`/`graph_dirty`; the actual `store.writeSnapshot` happens exactly
 * once per outer `transaction()`/`refresh()`/`acknowledge()` call, after that call's transaction has
 * committed — never once per internal write, and never inside the transaction itself. Asserted purely
 * by counting `writeSnapshot` calls (never by timing), per SDD-007's own test list.
 */
import { Neo4jGraphDatabase, type GraphStore } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
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

describe('PgProjectEngine outbox projection (WO-133)', () => {
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

  async function makeEngine(onProjectionError?: (err: unknown) => void): Promise<{ engine: PgProjectEngine; orgId: string; projectId: string; store: GraphStore }> {
    const org = await createOrganizationFixture(pg);
    const fixture = await createProjectFixture(pg, { orgId: org.id });
    const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
    if (!project) throw new Error('project fixture not found');
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
    await store.clear();
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), store, onProjectionError });
    return { engine, orgId: org.id, projectId: project.id, store };
  }

  test('a single write projects exactly once', async () => {
    const { engine, store } = await makeEngine();
    const writeSnapshot = vi.spyOn(store, 'writeSnapshot');

    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First')));

    expect(writeSnapshot).toHaveBeenCalledTimes(1);
  });

  test('multiple internal writes inside one outer transaction() coalesce into a single projection', async () => {
    const { engine, store } = await makeEngine();
    const writeSnapshot = vi.spyOn(store, 'writeSnapshot');

    // Mirrors "a WO claim followed immediately by a complete in the same request": several
    // ops.createDocument/ops.updateDocument calls inside one outer transaction().
    await engine.transaction(async (ops) => {
      await ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First'));
      await ops.createDocument('docs/feedback/FB-002-second.md', FB_TEMPLATE('FB-002', 'Second'));
      await ops.updateDocument('FB-001', { status: 'triaged' });
      await ops.refresh();
    });

    expect(writeSnapshot).toHaveBeenCalledTimes(1);
  });

  test('two separate transaction() calls each project once (not coalesced across calls)', async () => {
    const { engine, store } = await makeEngine();
    const writeSnapshot = vi.spyOn(store, 'writeSnapshot');

    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First')));
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-002-second.md', FB_TEMPLATE('FB-002', 'Second')));

    expect(writeSnapshot).toHaveBeenCalledTimes(2);
  });

  test('a read-only inspect() never projects', async () => {
    const { engine, store } = await makeEngine();
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First')));

    const writeSnapshot = vi.spyOn(store, 'writeSnapshot');
    await engine.inspect();
    await engine.scan();

    expect(writeSnapshot).not.toHaveBeenCalled();
  });

  test('recover() projects when a prior write left graph_dirty=true (crash-recovery path)', async () => {
    const { engine, projectId, store } = await makeEngine();
    await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First')));
    // Simulate a crash right after the write committed but before its own post-commit projection ran.
    await pg.ownerPool.query(`UPDATE "projects" SET graph_dirty = true WHERE id = $1`, [projectId]);

    const writeSnapshot = vi.spyOn(store, 'writeSnapshot');
    const result = await engine.recover();

    expect(result.recovered).toBe(true);
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    const row = await pg.ownerPool.query(`SELECT graph_dirty FROM "projects" WHERE id = $1`, [projectId]).then((r) => r.rows[0]);
    expect(row.graph_dirty).toBe(false);
  });

  test('recover() is a no-op (never projects) when the project is not dirty', async () => {
    const { engine, store } = await makeEngine();
    const writeSnapshot = vi.spyOn(store, 'writeSnapshot');

    const result = await engine.recover();

    expect(result.recovered).toBe(false);
    expect(writeSnapshot).not.toHaveBeenCalled();
  });

  test('a projection failure never fails the caller: the write still resolves and graph_dirty stays true', async () => {
    const onProjectionError = vi.fn();
    const { engine, projectId, store } = await makeEngine(onProjectionError);
    vi.spyOn(store, 'writeSnapshot').mockRejectedValueOnce(new Error('graph store unreachable'));

    const doc = await engine.transaction((ops) => ops.createDocument('docs/feedback/FB-001-first.md', FB_TEMPLATE('FB-001', 'First')));

    expect(doc.node.id).toBe('FB-001');
    expect(onProjectionError).toHaveBeenCalledTimes(1);
    const row = await pg.ownerPool.query(`SELECT graph_dirty FROM "projects" WHERE id = $1`, [projectId]).then((r) => r.rows[0]);
    expect(row.graph_dirty).toBe(true);

    // A later retry (e.g. recover()) succeeds once the store is reachable again.
    const recovered = await engine.recover();
    expect(recovered.recovered).toBe(true);
  });
});
