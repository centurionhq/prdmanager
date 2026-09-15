/**
 * `POST /api/v1/projects/:graphProjectId/import` (SDD-010 "Importador", WO-192): re-validates every
 * document with the real core schema, requires an empty project, rejects an unsafe source_path, and is
 * IDOR-safe / admin-only like every other `graphProjectId`-keyed bearer route.
 */
import { DEFAULT_AUTHORING, DEFAULT_FOLDERS, DEFAULT_GIT, DEFAULT_LIFECYCLE, generateProjectId, renderProjectFile } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { DEFAULT_IMPORT_RATE_LIMIT_PER_MINUTE } from '../../src/rate-limit/import-rate-limits.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

const TRIAGE_DEFAULTS = { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 };

function validPrdmYaml(grandfathered: { id: string; hash: string }[] = []): string {
  return renderProjectFile({
    project: { id: generateProjectId(), name: 'imported' },
    docsDir: 'docs',
    folders: DEFAULT_FOLDERS,
    ignore: [],
    git: DEFAULT_GIT,
    triage: TRIAGE_DEFAULTS,
    lifecycle: { grandfathered },
    authoring: DEFAULT_AUTHORING,
  });
}

function prdDoc(id: string): string {
  return `---\nid: ${id}\ntype: PRD\ntitle: "Imported feature"\nstatus: approved\n---\nBody for ${id}.\n`;
}

describe('POST /api/v1/projects/:graphProjectId/import (WO-192)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
  const ORIGIN = env.publicUrl;
  const PASSWORD = 'correct-horse-battery-staple';
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    pg = await openTestPg();
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  async function issuePersonalToken(app: ReturnType<typeof buildServer>, org: { slug: string }, cookie: string, scopes: string[]) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/app/tokens',
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { orgSlug: org.slug, name: 'importer', scopes, expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    expect(created.statusCode).toBe(200);
    return created.json().secret as string;
  }

  async function seedOwnerAndProject(app: ReturnType<typeof buildServer>) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    return { owner, org, project, cookie };
  }

  test('imports documents into an empty project, re-validating with the real core schema', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { schema_version: 1, prdmYaml: validPrdmYaml(), documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: prdDoc('PRD-001') }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 1, documents: [{ id: 'PRD-001', sourcePath: 'docs/prd/PRD-001.md' }] });

    const rows = (await pg.ownerPool.query(`SELECT doc_id, kind, origin, workflow_state, published_raw FROM documents WHERE project_id = $1`, [project.id])).rows;
    expect(rows).toEqual([{ doc_id: 'PRD-001', kind: 'PRD', origin: 'import', workflow_state: 'published', published_raw: prdDoc('PRD-001') }]);

    const versions = (await pg.ownerPool.query(`SELECT reason, content_hash, rendered_markdown, contributors FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE d.project_id = $1`, [project.id])).rows;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ reason: 'import', rendered_markdown: prdDoc('PRD-001'), contributors: ['system:import'] });
    expect(versions[0].content_hash).toMatch(/^[0-9a-f]{64}$/);

    await app.close();
  });

  test('rejects a second import into an already-imported (non-empty) project', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['import:write']);
    const body = { schema_version: 1 as const, prdmYaml: validPrdmYaml(), documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: prdDoc('PRD-001') }] };

    const first = await app.inject({ method: 'POST', url: `/api/v1/projects/${project.graphProjectId}/import`, headers: { authorization: `Bearer ${secret}` }, payload: body });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: `/api/v1/projects/${project.graphProjectId}/import`, headers: { authorization: `Bearer ${secret}` }, payload: body });
    expect(second.statusCode).toBe(409);

    await app.close();
  });

  test('two real concurrent import attempts into the same empty project: exactly one succeeds, never a mixed partial state (WO-235)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

    const bodyA = { schema_version: 1 as const, prdmYaml: validPrdmYaml(), documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: prdDoc('PRD-001') }] };
    const bodyB = { schema_version: 1 as const, prdmYaml: validPrdmYaml(), documents: [{ sourcePath: 'docs/prd/PRD-002.md', content: prdDoc('PRD-002') }] };

    const [resA, resB] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/projects/${project.graphProjectId}/import`, headers: { authorization: `Bearer ${secret}` }, payload: bodyA }),
      app.inject({ method: 'POST', url: `/api/v1/projects/${project.graphProjectId}/import`, headers: { authorization: `Bearer ${secret}` }, payload: bodyB }),
    ]);

    // Exactly one request won (200) and the other lost with the expected conflict (409) — never both
    // succeeding, and never both failing.
    const statuses = [resA.statusCode, resB.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const rows = (await pg.ownerPool.query(`SELECT doc_id FROM documents WHERE project_id = $1`, [project.id])).rows;
    // Never a corrupted mixed-import state (both PRD-001 and PRD-002 present, or neither) — exactly the
    // one document the winning request named.
    expect(rows).toHaveLength(1);
    expect(['PRD-001', 'PRD-002']).toContain(rows[0].doc_id);

    await app.close();
  }, 30_000);

  test('rejects a document whose id/type frontmatter fails core schema validation', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { schema_version: 1, prdmYaml: validPrdmYaml(), documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: '---\nid: PRD-001\ntype: PRD\n---\nno title\n' }] },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test.each([
    ['path traversal', '../evil/PRD-001.md'],
    ['absolute path', '/etc/passwd'],
    ['wrong kind folder', 'docs/sdd/PRD-001.md'],
    ['id mismatch', 'docs/prd/OTHER-001.md'],
    ['subdirectory under the kind folder', 'docs/prd/nested/PRD-001.md'],
  ])('rejects an unsafe source_path: %s', async (_label, sourcePath) => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { schema_version: 1, prdmYaml: validPrdmYaml(), documents: [{ sourcePath, content: prdDoc('PRD-001') }] },
    });
    expect(res.statusCode).toBe(400);

    const rows = (await pg.ownerPool.query(`SELECT 1 FROM documents WHERE project_id = $1`, [project.id])).rows;
    expect(rows).toHaveLength(0);

    await app.close();
  });

  test('a token from a different org gets 404 (IDOR-safe)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { project } = await seedOwnerAndProject(app);
    const other = await seedOwnerAndProject(app);
    const otherSecret = await issuePersonalToken(app, other.org, other.cookie, ['import:write']);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${otherSecret}` },
      payload: { schema_version: 1, prdmYaml: validPrdmYaml(), documents: [] },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  test('a non-admin project member gets 404, not 403 (never confirms the project exists)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project } = await seedOwnerAndProject(app);

    const member = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: member.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO project_members (project_id, org_id, user_id, role) VALUES ($1, $2, $3, 'developer')`, [project.id, org.id, member.id]);
    const memberCookie = await signIn(app, member.email);
    const memberSecret = await issuePersonalToken(app, org, memberCookie, ['import:write']);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${memberSecret}` },
      payload: { schema_version: 1, prdmYaml: validPrdmYaml(), documents: [] },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  test('a token without import:write gets 403 (scope check, not IDOR-relevant)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['mcp:read']);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { schema_version: 1, prdmYaml: validPrdmYaml(), documents: [] },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  test('an Origin outside the trusted allowlist is rejected; a trusted or absent Origin is fine (WO-249)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { project, cookie, org } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['import:write']);
    const body = { schema_version: 1 as const, prdmYaml: validPrdmYaml(), documents: [] };

    const untrusted = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${secret}`, origin: 'https://evil.example.test' },
      payload: body,
    });
    expect(untrusted.statusCode).toBe(403);
    expect(untrusted.json()).toEqual({ error: 'origin_not_allowed' });

    const trusted = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${secret}`, origin: ORIGIN },
      payload: body,
    });
    expect(trusted.statusCode).toBe(200);

    await app.close();
  });

  test('exceeding the per-token rate limit returns 429 (WO-259)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, cookie } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

    let lastStatus = 0;
    for (let i = 0; i <= DEFAULT_IMPORT_RATE_LIMIT_PER_MINUTE; i += 1) {
      // A brand new (empty) project every time: `ProjectNotEmptyError` would otherwise short-circuit
      // every call after the first, and this must exercise the rate limiter itself, not that guard.
      const freshProject = await createProjectFixture(pg, { orgId: org.id });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${freshProject.graphProjectId}/import`,
        headers: { authorization: `Bearer ${secret}` },
        payload: { schema_version: 1, prdmYaml: validPrdmYaml(), documents: [] },
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);

    await app.close();
  }, 30_000);

  test('the local .prdm.yaml project.id is never trusted: import always targets the URL graphProjectId', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, cookie } = await seedOwnerAndProject(app);
    const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

    // A .prdm.yaml claiming a totally different project id must have zero effect on which project is targeted.
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/import`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { schema_version: 1, prdmYaml: validPrdmYaml(), documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: prdDoc('PRD-001') }] },
    });
    expect(res.statusCode).toBe(200);

    const rows = (await pg.ownerPool.query(`SELECT project_id FROM documents WHERE doc_id = 'PRD-001'`)).rows;
    expect(rows).toEqual([{ project_id: project.id }]);

    await app.close();
  });

  function woDoc(id: string, opts: { resolvedBy?: string[]; blueprintHashes?: Record<string, string> } = {}): string {
    const resolvedBy = opts.resolvedBy ? `\nresolved_by: [${opts.resolvedBy.map((s) => `"${s}"`).join(', ')}]` : '';
    const blueprintHashes = opts.blueprintHashes ? `\nblueprint_hashes: {${Object.entries(opts.blueprintHashes).map(([k, v]) => `"${k}": "${v}"`).join(', ')}}` : '';
    return `---\nid: ${id}\ntype: WO\ntitle: "Imported work order"\nstatus: done\nimplements: ["SDD-001"]${resolvedBy}${blueprintHashes}\n---\nBody for ${id}.\n`;
  }

  function sddDoc(id: string): string {
    return `---\nid: ${id}\ntype: SDD\ntitle: "Imported blueprint"\narchitects: ["PRD-001"]\n---\nBody for ${id}.\n`;
  }

  describe('WO-193 side effects', () => {
    test('seeds id_counters from the imported ids, so the next locally-created document never collides', async () => {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
      const { org, project, cookie } = await seedOwnerAndProject(app);
      const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.graphProjectId}/import`,
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          schema_version: 1,
          prdmYaml: validPrdmYaml(),
          documents: [
            { sourcePath: 'docs/prd/PRD-007.md', content: prdDoc('PRD-007') },
            { sourcePath: 'docs/prd/PRD-003.md', content: prdDoc('PRD-003') },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const counters = (await pg.ownerPool.query(`SELECT kind, last_seq FROM id_counters WHERE project_id = $1`, [project.id])).rows;
      expect(counters).toEqual([{ kind: 'PRD', last_seq: 7 }]);

      await app.close();
    });

    test('imports lifecycle.grandfathered into projects.settings', async () => {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
      const { org, project, cookie } = await seedOwnerAndProject(app);
      const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.graphProjectId}/import`,
        headers: { authorization: `Bearer ${secret}` },
        payload: { schema_version: 1, prdmYaml: validPrdmYaml([{ id: 'PRD-001', hash: '0'.repeat(64) }]), documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: prdDoc('PRD-001') }] },
      });
      expect(res.statusCode).toBe(200);

      const rows = (await pg.ownerPool.query(`SELECT settings FROM projects WHERE id = $1`, [project.id])).rows;
      expect(rows[0].settings.lifecycle.grandfathered).toEqual([{ id: 'PRD-001', hash: '0'.repeat(64) }]);

      await app.close();
    });

    test('imports .prdm/baseline.json verbatim into project_baselines', async () => {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
      const { org, project, cookie } = await seedOwnerAndProject(app);
      const secret = await issuePersonalToken(app, org, cookie, ['import:write']);
      const baselineJson = JSON.stringify({ version: 1, docs: { 'PRD-001': 'a'.repeat(64) }, governs: {} });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.graphProjectId}/import`,
        headers: { authorization: `Bearer ${secret}` },
        payload: { schema_version: 1, prdmYaml: validPrdmYaml(), baselineJson, documents: [{ sourcePath: 'docs/prd/PRD-001.md', content: prdDoc('PRD-001') }] },
      });
      expect(res.statusCode).toBe(200);

      const rows = (await pg.ownerPool.query(`SELECT baseline FROM project_baselines WHERE project_id = $1`, [project.id])).rows;
      expect(rows[0].baseline).toEqual({ version: 1, docs: { 'PRD-001': 'a'.repeat(64) }, governs: {} });

      await app.close();
    });

    test('rejects an invalid .prdm/baseline.json rather than importing it', async () => {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
      const { org, project, cookie } = await seedOwnerAndProject(app);
      const secret = await issuePersonalToken(app, org, cookie, ['import:write']);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.graphProjectId}/import`,
        headers: { authorization: `Bearer ${secret}` },
        payload: { schema_version: 1, prdmYaml: validPrdmYaml(), baselineJson: 'not json', documents: [] },
      });
      expect(res.statusCode).toBe(400);

      await app.close();
    });

    test('records every resolved_by sha with trust: import, never baseline', async () => {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
      const { org, project, cookie } = await seedOwnerAndProject(app);
      const secret = await issuePersonalToken(app, org, cookie, ['import:write']);
      const sha = 'a'.repeat(40);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.graphProjectId}/import`,
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          schema_version: 1,
          prdmYaml: validPrdmYaml(),
          documents: [
            { sourcePath: 'docs/prd/PRD-001.md', content: prdDoc('PRD-001') },
            { sourcePath: 'docs/sdd/SDD-001.md', content: sddDoc('SDD-001') },
            { sourcePath: 'docs/work-orders/WO-001.md', content: woDoc('WO-001', { resolvedBy: [sha] }) },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const rows = (await pg.ownerPool.query(`SELECT sha, trust FROM commits WHERE project_id = $1`, [project.id])).rows;
      expect(rows).toEqual([{ sha, trust: 'import' }]);

      // The project never got a baseline head from import — the first real, CI-verified report is still
      // treated as this project's very first baseline (no force-push override needed).
      const codeState = (await pg.ownerPool.query(`SELECT latest_baseline_head_sha FROM project_code_state WHERE project_id = $1`, [project.id])).rows;
      expect(codeState).toEqual([]);

      await app.close();
    });

    test('audits resolved_by/blueprint_hashes/grandfathered as a privileged import', async () => {
      const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
      const { org, project, cookie } = await seedOwnerAndProject(app);
      const secret = await issuePersonalToken(app, org, cookie, ['import:write']);
      const sha = 'b'.repeat(40);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${project.graphProjectId}/import`,
        headers: { authorization: `Bearer ${secret}` },
        payload: {
          schema_version: 1,
          prdmYaml: validPrdmYaml([{ id: 'PRD-001', hash: '0'.repeat(64) }]),
          documents: [
            { sourcePath: 'docs/prd/PRD-001.md', content: prdDoc('PRD-001') },
            { sourcePath: 'docs/sdd/SDD-001.md', content: sddDoc('SDD-001') },
            { sourcePath: 'docs/work-orders/WO-001.md', content: woDoc('WO-001', { resolvedBy: [sha], blueprintHashes: { 'SDD-001': 'c'.repeat(64) } }) },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const audit = (await pg.ownerPool.query(`SELECT action, metadata FROM audit_log WHERE project_id = $1 AND action = 'project.imported'`, [project.id])).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].metadata).toMatchObject({ grandfatheredImported: true, importedCommitShas: 1, privilegedWorkOrders: ['WO-001'] });

      await app.close();
    });
  });
});
