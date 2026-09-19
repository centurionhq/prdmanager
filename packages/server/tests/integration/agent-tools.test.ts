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
import { buildProductForest, getProductTreeTool } from '../../src/agent/tools/get-product-tree.js';
import { getProjectStatusTool } from '../../src/agent/tools/get-project-status.js';
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
      conversationId: 'unused-in-this-suite',
      requestedBy: 'unused-in-this-suite',
      loadSubject: async () => (canView ? { orgRole: 'owner' } : {}),
    };
  }

  test('buildToolDefinitions advertises every read-only tool with a JSON Schema for each', () => {
    const definitions = buildToolDefinitions(READ_ONLY_AGENT_TOOLS);
    expect(definitions.map((d) => d.name)).toEqual([
      // WO-478 (SDD-037): the orientation pair leads, because it is what a conversation opens with.
      'get_project_status',
      'get_product_tree',
      'read_document',
      'search_project',
      'get_node',
      'get_feature_branch',
      'get_template',
      'validate_document',
    ]);
    for (const definition of definitions) {
      expect(definition.parameters.type).toBe('object');
      expect(definition.parameters).not.toHaveProperty('$schema');
    }
  });

  test('WO-476 (SDD-037/PRD-016): get_project_status answers "how is the project going?" with no id from the user', async () => {
    const base = await setupPublishedProject();
    const result = (await getProjectStatusTool.execute(contextFor(base, true), {})) as {
      project: string;
      documentsByKind: Record<string, number>;
      workOrders: { total: number; byStatus: Record<string, number> };
      recentBlueprints: { id: string }[];
    };

    // The whole point: no argument was passed, and it still knows which project it is in.
    expect(result.project).toBe(base.project.slug);
    expect(result.documentsByKind.PRD).toBe(1);
    expect(result.workOrders.total).toBe(0);
    expect(result.recentBlueprints).toEqual([]);
  });

  test('WO-476: get_project_status denies a caller without view permission', async () => {
    const base = await setupPublishedProject();
    await expect(getProjectStatusTool.execute(contextFor(base, false), {})).rejects.toBeInstanceOf(AgentToolPermissionError);
  });

  test('WO-477 (SDD-037/PRD-016): get_product_tree answers "what does the product do?" with no id from the user', async () => {
    const base = await setupPublishedProject();
    const result = (await getProductTreeTool.execute(contextFor(base, true), {})) as {
      project: string;
      features: { id: string; kind: string | null; title: string; children: unknown[] }[];
      totalFeatures: number;
      truncated: boolean;
    };

    expect(result.project).toBe(base.project.slug);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({ id: 'PRD-001', kind: 'PRD', title: 'Example feature' });
    expect(result).toMatchObject({ totalFeatures: 1, truncated: false });
  });

  test('WO-477: get_product_tree denies a caller without view permission', async () => {
    const base = await setupPublishedProject();
    await expect(getProductTreeTool.execute(contextFor(base, false), {})).rejects.toBeInstanceOf(AgentToolPermissionError);
  });

  test('WO-477: a PRD nests under the BC that justifies it, not under its EVOLVES_FROM parent', () => {
    // The nesting rule the Árbol screen already uses (SDD-029): JUSTIFIED_BY into a BC wins.
    const forest = buildProductForest({
      nodes: [
        { ref: 'MRD-001', label: 'Feature', kind: 'MRD', title: 'The market', status: 'approved' },
        { ref: 'BC-001', label: 'Feature', kind: 'BC', title: 'The case', status: 'approved' },
        { ref: 'PRD-001', label: 'Feature', kind: 'PRD', title: 'The feature', status: 'approved' },
        { ref: 'SDD-001', label: 'Blueprint', kind: 'SDD', title: 'The design', status: 'published' },
      ],
      edges: [
        { from: 'BC-001', to: 'MRD-001', type: 'EVOLVES_FROM', status: null, reviewNeeded: false },
        { from: 'PRD-001', to: 'MRD-001', type: 'EVOLVES_FROM', status: null, reviewNeeded: false },
        { from: 'PRD-001', to: 'BC-001', type: 'JUSTIFIED_BY', status: null, reviewNeeded: false },
        { from: 'SDD-001', to: 'PRD-001', type: 'ARCHITECTS', status: null, reviewNeeded: false },
      ],
    });

    expect(forest.features).toHaveLength(1);
    expect(forest.features[0]?.id).toBe('MRD-001');
    expect(forest.features[0]?.children.map((c) => c.id)).toEqual(['BC-001']);
    expect(forest.features[0]?.children[0]?.children.map((c) => c.id)).toEqual(['PRD-001']);
    // Blueprints belong to get_project_status; mixing them in is the confusion this pair removes.
    expect(JSON.stringify(forest)).not.toContain('SDD-001');
    expect(forest.totalFeatures).toBe(3);
  });

  test('WO-477: a cycle in EVOLVES_FROM does not hang the walk', () => {
    const forest = buildProductForest({
      nodes: [
        { ref: 'PRD-001', label: 'Feature', kind: 'PRD', title: 'A', status: null },
        { ref: 'PRD-002', label: 'Feature', kind: 'PRD', title: 'B', status: null },
      ],
      edges: [
        { from: 'PRD-001', to: 'PRD-002', type: 'EVOLVES_FROM', status: null, reviewNeeded: false },
        { from: 'PRD-002', to: 'PRD-001', type: 'EVOLVES_FROM', status: null, reviewNeeded: false },
      ],
    });
    // Every node has a parent, so the cycle yields no roots rather than looping forever.
    expect(forest.features).toEqual([]);
    expect(forest.totalFeatures).toBe(2);
  });

  test('WO-477: a project far larger than the output budget returns well-formed JSON that says it was truncated', () => {
    // 1000 features in one flat generation. Truncating at the ~20 KB dispatcher cap would cut the JSON
    // mid-feature and leave the model parsing garbage with no idea anything was missing.
    const nodes = Array.from({ length: 1000 }, (_, i) => ({
      ref: `PRD-${String(i).padStart(4, '0')}`,
      label: 'Feature',
      kind: 'PRD',
      title: `Feature number ${i} with a reasonably long title to take up room`,
      status: 'approved',
    }));
    const forest = buildProductForest({ nodes, edges: [] });

    expect(forest.truncated).toBe(true);
    expect(forest.totalFeatures).toBe(1000);
    expect(forest.features.length).toBeLessThan(1000);
    expect(Buffer.byteLength(JSON.stringify(forest), 'utf8')).toBeLessThan(20 * 1024);
    // Still valid JSON describing whole features, never a half-written one.
    expect(() => JSON.parse(JSON.stringify(forest))).not.toThrow();
  });

  test('WO-516/WO-517 (SDD-045/FB-025): walking the graph brings no document bodies, and the body is one explicit argument away', async () => {
    const base = await setupPublishedProject();
    const ctx = contextFor(base, true);

    const structural = (await getNodeTool.execute(ctx, { id: 'PRD-001' })) as { found: boolean; node?: Record<string, unknown> } & Record<string, unknown>;
    const flat = structural.node ?? structural;

    expect(structural.found).toBe(true);
    // The measured problem: `body` was 86 % of a 12 KB result, twelve times over in one turn.
    expect(flat).not.toHaveProperty('body');
    // Identity and links still come back -- this is a narrowing of payload, not of capability.
    expect(JSON.stringify(structural)).toContain('PRD-001');

    // And internal bookkeeping the model can do nothing with is gone.
    for (const internal of ['project_id', 'content_hash', 'tags_text']) {
      expect(flat).not.toHaveProperty(internal);
    }

    const withBody = (await getNodeTool.execute(ctx, { id: 'PRD-001', includeBody: true })) as { node?: Record<string, unknown> } & Record<string, unknown>;
    expect(withBody.node ?? withBody).toHaveProperty('body');
  });

  test('WO-517: a feature branch is structure only, and stays small per node', async () => {
    const base = await setupPublishedProject();
    const branch = (await getFeatureBranchTool.execute(contextFor(base, true), { featureId: 'PRD-001' })) as { found: boolean; nodes: Record<string, unknown>[] };

    expect(branch.found).toBe(true);
    for (const node of branch.nodes) {
      expect(node).not.toHaveProperty('body');
      expect(node).not.toHaveProperty('project_id');
    }

    // Four of these accounted for 79_662 bytes of one real turn. Structure alone is hundreds of bytes
    // per node, not thousands.
    const bytesPerNode = branch.nodes.length === 0 ? 0 : JSON.stringify(branch.nodes).length / branch.nodes.length;
    expect(bytesPerNode).toBeLessThan(1_000);
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
