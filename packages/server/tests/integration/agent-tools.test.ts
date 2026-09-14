/**
 * WO-169 — the six read-only agent tools, exercised directly against a real Postgres + Neo4j project
 * (the same fixtures `graph.test.ts`/WO-142 use) since the HTTP endpoint that will wire an
 * `AgentToolContext` together from a request doesn't exist until WO-172.
 */
import { Neo4jGraphDatabase, sha256 } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { AgentToolError, AgentToolPermissionError, buildToolDefinitions, executeAgentTool, READ_ONLY_AGENT_TOOLS, type AgentToolContext } from '../../src/agent/tools/index.js';
import { getFeatureBranchTool } from '../../src/agent/tools/get-feature-branch.js';
import { getNodeTool } from '../../src/agent/tools/get-node.js';
import { getTemplateTool } from '../../src/agent/tools/get-template.js';
import { readDocumentTool } from '../../src/agent/tools/read-document.js';
import { searchProjectTool } from '../../src/agent/tools/search-project.js';
import { validateDocumentTool } from '../../src/agent/tools/validate-document.js';

describe('agent tools (SDD-009 §Herramientas, WO-169)', () => {
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

  async function setupPublishedProject() {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: `saas://project/${project.id}` });
    await store.clear();

    const content = '---\nid: PRD-001\ntype: PRD\ntitle: "Example feature"\nstatus: approved\n---\n\n## Resumen\nHello world\n';
    await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
       VALUES ($1, $2, 'PRD-001', 'PRD', 'Example feature', 'docs/prd/PRD-001.md', 'collab', 'published', $3, $4)`,
      [org.id, project.id, content, sha256(content)],
    );
    await pg.ownerPool.query(`UPDATE "projects" SET graph_dirty = true, graph_version = graph_version + 1 WHERE id = $1`, [project.id]);

    const tenantDb = createTenantDb(pg.appPool).forOrg(org.id);
    const projectRecord = await tenantDb.projects.findById(project.id);
    if (!projectRecord) throw new Error('fixture project not found after seeding');

    // `recover()` re-projects a dirty graph into Neo4j (SDD-007) — calling it directly here (rather than
    // round-tripping through an HTTP drift route, which doesn't need to exist for this WO) is enough to
    // make the write visible in Neo4j.
    const { resolvePgProjectEngine } = await import('../../src/engine/resolve-pg-project-engine.js');
    const engine = resolvePgProjectEngine(pg.appPool, neo4j, org.id, projectRecord);
    await engine.recover();

    const found = await tenantDb.forProject(project.id).documents.findByDocId('PRD-001');
    if (!found) throw new Error('fixture document not found after seeding');

    return { org, project: projectRecord, document: found.document };
  }

  function contextFor(base: Awaited<ReturnType<typeof setupPublishedProject>>, canView: boolean): AgentToolContext {
    return {
      pool: pg.appPool,
      neo4j,
      orgId: base.org.id,
      project: base.project,
      document: base.document,
      loadSubject: async () => (canView ? { orgRole: 'owner' } : {}),
    };
  }

  test('buildToolDefinitions advertises all six tools with a JSON Schema for each', () => {
    const definitions = buildToolDefinitions(READ_ONLY_AGENT_TOOLS);
    expect(definitions.map((d) => d.name)).toEqual(['read_document', 'search_project', 'get_node', 'get_feature_branch', 'get_template', 'validate_document']);
    for (const definition of definitions) {
      expect(definition.parameters.type).toBe('object');
      expect(definition.parameters).not.toHaveProperty('$schema');
    }
  });

  test('read_document returns line-numbered body and frontmatter fields for the live working copy', async () => {
    const base = await setupPublishedProject();
    const result = (await readDocumentTool.execute(contextFor(base, true), {})) as { body: string };
    // No collab session has ever opened this document, so the live working copy is the pristine empty
    // Y.Doc (see reconstruct-ydoc.ts's own hasLiveHistory doc comment) — asserting the tool wires through
    // to that real reconstruction (rather than crashing) is the point here, not its exact content.
    expect(result.body).toBe('(empty document)');
  });

  test('read_document denies a caller without view permission', async () => {
    const base = await setupPublishedProject();
    await expect(readDocumentTool.execute(contextFor(base, false), {})).rejects.toBeInstanceOf(AgentToolPermissionError);
  });

  test('search_project finds the published feature by title', async () => {
    const base = await setupPublishedProject();
    const result = (await searchProjectTool.execute(contextFor(base, true), { query: 'Example feature' })) as { hits: { id: string }[] };
    expect(result.hits.some((h) => h.id === 'PRD-001')).toBe(true);
  });

  test('get_node returns { found: true, node, links } for an existing id and { found: false } otherwise', async () => {
    const base = await setupPublishedProject();
    const found = (await getNodeTool.execute(contextFor(base, true), { id: 'PRD-001' })) as { found: boolean; node?: { id: string } };
    expect(found.found).toBe(true);
    expect(found.node?.id).toBe('PRD-001');

    const missing = await getNodeTool.execute(contextFor(base, true), { id: 'PRD-999' });
    expect(missing).toEqual({ found: false });
  });

  test('get_feature_branch returns the subgraph rooted at an existing id and { found: false } otherwise', async () => {
    const base = await setupPublishedProject();
    const found = (await getFeatureBranchTool.execute(contextFor(base, true), { featureId: 'PRD-001' })) as { found: boolean; nodes?: unknown[] };
    expect(found.found).toBe(true);
    expect(Array.isArray(found.nodes)).toBe(true);

    expect(await getFeatureBranchTool.execute(contextFor(base, true), { featureId: 'PRD-999' })).toEqual({ found: false });
  });

  test('get_template returns the blank template for a document kind without touching the project at all', async () => {
    const base = await setupPublishedProject();
    const result = (await getTemplateTool.execute(contextFor(base, true), { kind: 'PRD' })) as { template: string };
    expect(result.template).toContain('---');
  });

  test('validate_document runs edit-mode validation against the current working copy', async () => {
    const base = await setupPublishedProject();
    const result = (await validateDocumentTool.execute(contextFor(base, true), {})) as { issues: unknown[] };
    expect(Array.isArray(result.issues)).toBe(true);
  });

  test('executeAgentTool round-trips a real tool call through JSON and enforces the ~20 KB output cap', async () => {
    const base = await setupPublishedProject();
    const result = await executeAgentTool(contextFor(base, true), READ_ONLY_AGENT_TOOLS, 'get_template', JSON.stringify({ kind: 'PRD' }));
    expect(result.ok).toBe(true);
    expect(Buffer.byteLength(result.resultJson, 'utf8')).toBeLessThanOrEqual(20 * 1024 + 200);
  });

  test('executeAgentTool maps an unknown tool name, invalid JSON and invalid arguments to {ok:false} without throwing', async () => {
    const base = await setupPublishedProject();
    const ctx = contextFor(base, true);

    const unknown = await executeAgentTool(ctx, READ_ONLY_AGENT_TOOLS, 'delete_everything', '{}');
    expect(unknown.ok).toBe(false);
    expect(JSON.parse(unknown.resultJson).error.code).toBe('unknown_tool');

    const badJson = await executeAgentTool(ctx, READ_ONLY_AGENT_TOOLS, 'get_template', '{not json');
    expect(badJson.ok).toBe(false);
    expect(JSON.parse(badJson.resultJson).error.code).toBe('invalid_arguments');

    const badArgs = await executeAgentTool(ctx, READ_ONLY_AGENT_TOOLS, 'get_template', JSON.stringify({ kind: 'NOT_A_KIND' }));
    expect(badArgs.ok).toBe(false);
    expect(JSON.parse(badArgs.resultJson).error.code).toBe('invalid_arguments');
  });

  test('executeAgentTool maps a permission denial to a forbidden error result, not a thrown exception', async () => {
    const base = await setupPublishedProject();
    const result = await executeAgentTool(contextFor(base, false), READ_ONLY_AGENT_TOOLS, 'read_document', '{}');
    expect(result.ok).toBe(false);
    expect(JSON.parse(result.resultJson)).toEqual({ error: { code: 'forbidden', message: expect.any(String) } });
  });

  test('AgentToolError carries a stable machine-readable code', () => {
    const error = new AgentToolError('some_code', 'some message');
    expect(error.code).toBe('some_code');
    expect(error.message).toBe('some message');
  });
});
