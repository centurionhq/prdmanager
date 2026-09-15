/**
 * `POST /api/v1/projects/:graphProjectId/policy-docs` (SDD-010, WO-183): documents evaluated at each
 * sha's own recorded `first_seen_at`, never at the date git log claims, and "now" for an unreported
 * sha — a whole batch resolved in a single request.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { seedUser } from '../helpers/seed-auth.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

describe('POST /api/v1/projects/:graphProjectId/policy-docs (WO-183)', () => {
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

  async function setupProject(app: ReturnType<typeof buildServer>) {
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    const org = await createOrganizationFixture(pg);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    const project = await createProjectFixture(pg, { orgId: org.id });
    const cookie = await signIn(app, owner.email);
    const created = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/ci-tokens`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { name: 'ci-pipeline', scopes: ['governance:read'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
    });
    const secret = created.json().secret as string;
    return { org, project, secret };
  }

  async function insertDocumentWithVersions(orgId: string, projectId: string, docId: string, versions: { content: string; createdAt: string }[]) {
    const { rows } = await pg.ownerPool.query(
      `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state)
       VALUES ($1, $2, $3, 'ADR', 'Policy', $4, 'generated', 'published') RETURNING id`,
      [orgId, projectId, docId, `docs/adr/${docId}.md`],
    );
    const documentId = rows[0].id as string;
    for (let i = 0; i < versions.length; i += 1) {
      const v = versions[i]!;
      await pg.ownerPool.query(
        `INSERT INTO "document_versions" (org_id, document_id, version_no, reason, rendered_markdown, content_hash, created_at)
         VALUES ($1, $2, $3, 'engine_write', $4, 'deadbeef', $5)`,
        [orgId, documentId, i + 1, v.content, v.createdAt],
      );
    }
  }

  test('evaluates a reported sha at its own first_seen_at, and an unreported sha as of now', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, secret } = await setupProject(app);

    // Two versions of the same policy doc: an old one and a newer one.
    await insertDocumentWithVersions(org.id, project.id, 'ADR-001', [
      { content: 'old rule', createdAt: '2020-01-01T00:00:00.000Z' },
      { content: 'new rule', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    // A commit reported (and recorded) well before the newer version existed.
    const oldSha = 'a'.repeat(40);
    await pg.ownerPool.query(
      `INSERT INTO "commits" (project_id, org_id, sha, trust, author, date, subject, first_seen_at) VALUES ($1, $2, $3, 'preview', 'Alice', now(), 'x', '2021-06-01T00:00:00.000Z')`,
      [project.id, org.id, oldSha],
    );

    const unreportedSha = 'b'.repeat(40);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/policy-docs`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { shas: [oldSha, unreportedSha] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(2);

    const oldResult = body.results.find((r: { sha: string }) => r.sha === oldSha);
    expect(oldResult.evaluatedAt).toBe('2021-06-01T00:00:00.000Z');
    expect(oldResult.documents).toEqual([{ id: 'ADR-001', sourcePath: 'docs/adr/ADR-001.md', content: 'old rule' }]);

    const unreportedResult = body.results.find((r: { sha: string }) => r.sha === unreportedSha);
    expect(unreportedResult.documents).toEqual([{ id: 'ADR-001', sourcePath: 'docs/adr/ADR-001.md', content: 'new rule' }]);
    // evaluated "as of now": close to the request time, not any date the request itself could control.
    expect(new Date(unreportedResult.evaluatedAt).getTime()).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));

    await app.close();
  });

  test('a sha reported before any version of a document existed sees no documents for it', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { org, project, secret } = await setupProject(app);
    await insertDocumentWithVersions(org.id, project.id, 'ADR-002', [{ content: 'rule', createdAt: '2026-01-01T00:00:00.000Z' }]);

    const veryOldSha = 'c'.repeat(40);
    await pg.ownerPool.query(
      `INSERT INTO "commits" (project_id, org_id, sha, trust, author, date, subject, first_seen_at) VALUES ($1, $2, $3, 'preview', 'Alice', now(), 'x', '2020-01-01T00:00:00.000Z')`,
      [project.id, org.id, veryOldSha],
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/policy-docs`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { shas: [veryOldSha] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].documents).toEqual([]);

    await app.close();
  });

  test('rejects a request body over the explicit bodyLimit before it ever reaches the schema/handler (WO-237)', async () => {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    const { project, secret } = await setupProject(app);

    // Comfortably over MAX_POLICY_DOCS_BODY_BYTES (32 KiB): 800 full-length shas is already more than
    // MAX_POLICY_DOCS_SHAS (500) would ever allow through the schema, but bodyLimit rejects the raw
    // bytes first — this proves the explicit limit itself is wired up, not just the array-length cap.
    // Status is 500 (not Fastify's usual 413): this app's shared `setErrorHandler` (SDD-006) maps every
    // non-`HttpError` — including Fastify's own built-in `FST_ERR_CTP_BODY_TOO_LARGE` — to a generic
    // `internal_error`/500, the same pre-existing behavior every other route's `bodyLimit` already has
    // (e.g. `import`/`code-reports`); fixing that shared mapping is outside this WO's scope.
    const oversizedShas = Array.from({ length: 800 }, (_, i) => i.toString(16).padStart(40, '0'));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.graphProjectId}/policy-docs`,
      headers: { authorization: `Bearer ${secret}` },
      payload: { shas: oversizedShas },
    });
    expect(res.statusCode).toBe(500);

    await app.close();
  });
});
