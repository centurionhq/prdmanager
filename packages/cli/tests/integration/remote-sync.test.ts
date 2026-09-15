/**
 * `prdm sync` in remote mode, end to end against a real in-process server (SDD-010 "Sync de developers y
 * drift", WO-195): governance fetch + local cache write + scanContents/resolveGoverned/readCommits/
 * dirtyPaths + code-report POST, all against a real (disposable) test-database project.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RemoteProjectFile } from '@prdm/core';
import { createMemberFixture, createOrganizationFixture, createProjectFixture, makeTmpDir, openTestPg, removeDir, truncateAll, writeFiles, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '@prdm/server';
import { FakeMailer } from '../../../server/src/mailer.js';
import { mutationHeaders } from '../../../server/tests/helpers/csrf.js';
import { seedUser } from '../../../server/tests/helpers/seed-auth.js';
import { buildTestServerEnv } from '../../../server/tests/helpers/test-env.js';
import { saveCredentials } from '../../src/remote/credentials.js';
import { runRemoteSync } from '../../src/remote/sync.js';

describe('prdm sync remote mode (SDD-010, WO-195)', () => {
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

  function initGitRepo(root: string): void {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: root });
  }

  test('full flow: governance -> local cache -> code-report, printed as preview drift', async () => {
    const { app, baseUrl } = await startApp();
    let root: string | undefined;
    let xdgHome: string | undefined;
    try {
      const owner = await seedUser(env, pg.appPool, PASSWORD);
      const org = await createOrganizationFixture(pg);
      await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
      const project = await createProjectFixture(pg, { orgId: org.id });
      const cookie = await signIn(app, owner.email);

      const prdContent = '---\nid: PRD-001\ntype: PRD\ntitle: "Feature"\nstatus: approved\n---\nBody.\n';
      const sddContent = '---\nid: SDD-001\ntype: SDD\ntitle: "Blueprint"\narchitects: ["PRD-001"]\nimpacts_paths: ["src/sync/**"]\n---\nBody.\n';
      await pg.ownerPool.query(
        `INSERT INTO "documents" (org_id, project_id, doc_id, kind, title, source_path, origin, workflow_state, published_raw, published_content_hash)
         VALUES ($1, $2, 'PRD-001', 'PRD', 'Feature', 'docs/prd/PRD-001.md', 'generated', 'published', $3, 'deadbeef'),
                ($1, $2, 'SDD-001', 'SDD', 'Blueprint', 'docs/sdd/SDD-001.md', 'generated', 'published', $4, 'deadbeef')`,
        [org.id, project.id, prdContent, sddContent],
      );

      const tokenRes = await app.inject({
        method: 'POST',
        url: '/api/app/tokens',
        headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
        payload: { orgSlug: org.slug, name: 'sync', scopes: ['governance:read', 'reports:write'], expiresAt: new Date(Date.now() + DAY_MS).toISOString() },
      });
      const secret = tokenRes.json().secret as string;

      root = makeTmpDir('prdm-remote-sync-e2e-');
      xdgHome = makeTmpDir('prdm-remote-sync-e2e-xdg-');
      writeFiles(root, { 'src/sync/monitor.ts': 'export function detect() { return 1; }\n' });
      initGitRepo(root);
      saveCredentials({ [baseUrl]: { token: secret } }, { XDG_CONFIG_HOME: xdgHome });

      const remoteFile: RemoteProjectFile = { version: 2, project: { id: project.graphProjectId, name: project.name }, remote: { server: baseUrl, org: org.slug, project: project.slug, offlinePolicy: 'warn' } };

      // No --check: real lifecycle issues (e.g. PRD-001 missing a "justified_by") are printed but must
      // never throw — this test proves the full remote pipeline actually wires together end to end
      // (governance fetch, local cache, scanContents/resolveGoverned/readCommits/dirtyPaths, code-report
      // POST, printed response), not that this minimal fixture is itself lifecycle-clean.
      const lines: string[] = [];
      await runRemoteSync(root, remoteFile, {}, { stdout: (l) => lines.push(l), env: { XDG_CONFIG_HOME: xdgHome } });

      expect(lines).toHaveLength(1);
      const printedLines = lines[0]!.split('\n');
      expect(printedLines[0]).toBe('mode: preview');
      expect(printedLines[1]).toMatch(/^head: [0-9a-f]{40}$/);
      expect(readCache(root, 'docs/SDD-001.md')).toBe(sddContent);
      expect(readCache(root, 'docs/PRD-001.md')).toBe(prdContent);

      // --check against that same real, server-computed drift does throw.
      await expect(runRemoteSync(root, remoteFile, { check: true }, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome } })).rejects.toThrow(/blocking issues/);
    } finally {
      await app.close();
      if (root) removeDir(root);
      if (xdgHome) removeDir(xdgHome);
    }
  }, 30_000);
});

function readCache(root: string, relPath: string): string {
  return readFileSync(join(root, '.prdm/remote', relPath), 'utf8');
}
