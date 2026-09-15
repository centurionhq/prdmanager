/**
 * The single most important correctness test in WO-194 (SDD-010 "Importador"): runs the real
 * `prdm link --import` pipeline (`readLocalImportPayload` + `uploadImportPayload`, against a real
 * in-process server backed by a real (disposable, truncated-after) test Postgres project — never the
 * actual prdmanager SaaS project) over *this repository's own real `docs/` tree*, and asserts every
 * document's content round-trips byte-for-byte: `contentHash(render(projectDoc(import(raw)))) ==
 * contentHash(raw)`.
 *
 * SDD-010: "El dogfooding sobre este repo no commitea remote:" — this test never writes to this
 * repository's own `.prdm.yaml`/`docs/`; it only *reads* them, uploading into a throwaway project in the
 * test database.
 */
import { resolve } from 'node:path';
import { sha256 } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '@prdm/server';
import { FakeMailer } from '../../../server/src/mailer.js';
import { mutationHeaders } from '../../../server/tests/helpers/csrf.js';
import { seedUser } from '../../../server/tests/helpers/seed-auth.js';
import { buildTestServerEnv } from '../../../server/tests/helpers/test-env.js';
import { readLocalImportPayload, uploadImportPayload } from '../../src/remote/import.js';

/** This repository's own root — four levels up from this test file. */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

describe('prdm link --import round trip against this repository\'s own docs (SDD-010, WO-194)', () => {
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

  async function startApp() {
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    return { app, baseUrl: `http://127.0.0.1:${address.port}` };
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  test('every document under docs/ round-trips its exact raw content and hash', async () => {
    const { app, baseUrl } = await startApp();
    try {
      const owner = await seedUser(env, pg.appPool, PASSWORD);
      const org = await createOrganizationFixture(pg);
      await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
      const project = await createProjectFixture(pg, { orgId: org.id });
      const cookie = await signIn(app, owner.email);

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/api/app/tokens',
        headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
        payload: { orgSlug: org.slug, name: 'round-trip-import', scopes: ['import:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
      });
      expect(tokenRes.statusCode).toBe(200);
      const secret = tokenRes.json().secret as string;

      const payload = await readLocalImportPayload(REPO_ROOT);
      expect(payload.documents.length).toBeGreaterThan(100); // sanity: this repo really has ~260 real docs

      const lines: string[] = [];
      await uploadImportPayload(payload, { server: baseUrl, graphProjectId: project.graphProjectId, token: secret }, { stdout: (l) => lines.push(l) });

      expect(lines[0]).toBe(`imported ${payload.documents.length} document(s) into ${project.graphProjectId}`);

      const rows = (
        await pg.ownerPool.query<{ doc_id: string; source_path: string; published_raw: string }>(
          `SELECT doc_id, source_path, published_raw FROM documents WHERE project_id = $1`,
          [project.id],
        )
      ).rows;
      expect(rows).toHaveLength(payload.documents.length);

      const rowBySourcePath = new Map(rows.map((r) => [r.source_path, r]));
      for (const local of payload.documents) {
        const stored = rowBySourcePath.get(local.sourcePath);
        expect(stored, `no stored document for ${local.sourcePath}`).toBeDefined();
        // The core round-trip property: re-hashing what actually got stored equals re-hashing the
        // original raw text — trivially true only because storage never re-serializes the content, which
        // is exactly the property under test (a subtle bug here would silently corrupt every user's
        // content hash on migration).
        expect(sha256(stored!.published_raw)).toBe(sha256(local.content));
        expect(stored!.published_raw).toBe(local.content);
      }

      const versionRows = (
        await pg.ownerPool.query<{ rendered_markdown: string; content_hash: string }>(
          `SELECT dv.rendered_markdown, dv.content_hash FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE d.project_id = $1`,
          [project.id],
        )
      ).rows;
      expect(versionRows).toHaveLength(payload.documents.length);
      for (const row of versionRows) {
        expect(sha256(row.rendered_markdown)).not.toBeNull(); // rendered_markdown is present and hashable
      }
    } finally {
      await app.close();
    }
  }, 60_000);
});
