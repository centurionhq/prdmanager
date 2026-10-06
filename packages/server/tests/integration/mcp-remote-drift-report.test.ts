/**
 * Remote MCP profile's `get_drift_report` over a REAL `PgProjectEngine` (WO-605, SDD-010).
 *
 * Why this exists: `packages/mcp/tests/integration/mcp-remote-profile.test.ts` mounts the profile on the
 * in-memory `Engine`, whose `lastReport()` is populated by the `refresh()` in its `beforeAll`. That suite
 * could therefore never see the `null` stub `PgProjectEngine.lastReport()` used to be, which is how the bug
 * slipped through. Here the profile sits on Postgres-backed state and we assert the contract: no persisted
 * report → `{ hasReport: false }`; persisted report → returned verbatim; never refresh, never scan, never
 * write a baseline.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Neo4jGraphDatabase, type GraphStore } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { registerPrdmTools, type PrdmDeps } from '@prdm/mcp/lib';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createPgProjectEngine, type PgProjectEngine } from '../../src/engine/pg-project-engine.js';
import { buildPrdmConfig, buildProjectSettings, saasProjectRoot } from '../../src/engine/pg-project-settings.js';

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

interface RemoteHandle {
  client: Client;
  close: () => Promise<void>;
}

describe('get_drift_report sobre PgProjectEngine (WO-605)', () => {
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

  async function makeProject(): Promise<{ engine: PgProjectEngine; orgId: string; projectId: string; deps: PrdmDeps }> {
    const org = await createOrganizationFixture(pg);
    const fixture = await createProjectFixture(pg, { orgId: org.id });
    const project = await createTenantDb(pg.appPool).forOrg(org.id).projects.findById(fixture.id);
    if (!project) throw new Error('project fixture not found');
    const store: GraphStore = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
    await store.clear();
    const engine = createPgProjectEngine({ pool: pg.appPool, orgId: org.id, projectId: project.id, settings: buildProjectSettings(project), store });
    const deps: PrdmDeps = { config: buildPrdmConfig(project), store: engine.store, engine };
    return { engine, orgId: org.id, projectId: project.id, deps };
  }

  async function openRemote(deps: PrdmDeps): Promise<RemoteHandle> {
    const server = new McpServer({ name: 'test-remote-pg', version: '0.0.0' });
    registerPrdmTools(server, deps, { profile: 'remote' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-remote-pg-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  async function readReport(client: Client): Promise<Record<string, unknown> & { hasReport?: boolean; documents: number }> {
    const result = await client.callTool({ name: 'get_drift_report', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    return JSON.parse(content[0]!.text) as Record<string, unknown> & { hasReport?: boolean; documents: number };
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

  const readBaseline = (projectId: string) => pg.ownerPool.query('SELECT baseline, updated_at FROM project_baselines WHERE project_id = $1', [projectId]);
  const readLastReport = (projectId: string) => pg.ownerPool.query('SELECT last_report FROM project_code_state WHERE project_id = $1', [projectId]);

  test('sin reporte persistido: hasReport:false y no refresca ni escribe baseline', async () => {
    const { engine, projectId, deps } = await makeProject();
    const refreshSpy = vi.spyOn(engine, 'refresh');
    const inspectSpy = vi.spyOn(engine, 'inspect');

    const remote = await openRemote(deps);
    try {
      const body = await readReport(remote.client);

      expect(body).toEqual({ hasReport: false });
    } finally {
      await remote.close();
    }

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(inspectSpy).not.toHaveBeenCalled();
    const baseline = await pg.ownerPool.query('SELECT 1 FROM project_baselines WHERE project_id = $1', [projectId]);
    expect(baseline.rowCount).toBe(0);
    const lastReport = await readLastReport(projectId);
    expect(lastReport.rows.length === 0 || lastReport.rows[0].last_report === null).toBe(true);
  });

  test('con reporte persistido: devuelve el reporte real y no re-refresca ni reescribe baseline', async () => {
    const { engine, orgId, projectId, deps } = await makeProject();
    await seedFeature(orgId, projectId);
    await seedBlueprint(orgId, projectId, 'SDD-001', ['src/a.ts']);
    const report = await engine.refresh();
    expect(await engine.lastReport()).toEqual(report);
    const baselineBefore = await readBaseline(projectId);
    const lastReportBefore = await readLastReport(projectId);
    const refreshSpy = vi.spyOn(engine, 'refresh');
    const inspectSpy = vi.spyOn(engine, 'inspect');

    const remote = await openRemote(deps);
    try {
      const body = await readReport(remote.client);

      expect(body.hasReport).not.toBe(false);
      // The persisted report, verbatim (JSON round-trip).
      expect(body).toEqual(report);
    } finally {
      await remote.close();
    }

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(inspectSpy).not.toHaveBeenCalled();
    const baselineAfter = await readBaseline(projectId);
    const lastReportAfter = await readLastReport(projectId);
    expect(baselineAfter.rows).toEqual(baselineBefore.rows);
    expect(lastReportAfter.rows).toEqual(lastReportBefore.rows);
  });

  test('no re-escanea: un documento posterior al refresh no aparece en el reporte remoto', async () => {
    const { engine, orgId, projectId, deps } = await makeProject();
    await seedFeature(orgId, projectId);
    await seedBlueprint(orgId, projectId, 'SDD-001', ['src/a.ts']);
    const report = await engine.refresh();
    // Only a real scan would count this one.
    await seedBlueprint(orgId, projectId, 'SDD-002', ['src/b.ts']);

    const remote = await openRemote(deps);
    try {
      const body = await readReport(remote.client);

      expect(body.documents).toBe(report.documents);
    } finally {
      await remote.close();
    }

    // Proves SDD-002 is visible to a real scan, so the assertion above isn't vacuous.
    const fresh = await engine.inspect();
    expect(fresh.documents).toBe(report.documents + 1);
  });
});
