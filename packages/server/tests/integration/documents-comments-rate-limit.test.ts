/**
 * Security review #2 (HIGH, WO-219) — comment thread creation had a body-size cap
 * (`createCommentThreadInputSchema`) but no volume limit: a client could fire an unbounded number of
 * threads per minute. `../../src/rate-limit/comment-rate-limits.js` now caps this per user and per
 * document, checked the same way `invitation-accept-rate-limit.test.ts` checks WO-105's limiter — a fake
 * clock (`createClockStore`) advances the window deterministically, never a real `sleep`.
 */
import { createMemberFixture, createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { createClockStore } from '../../src/rate-limit/clock-store.js';
import { COMMENT_RATE_LIMIT_CONFIG } from '../../src/rate-limit/comment-rate-limits.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

function fakeClock(startMs = 0) {
  let current = startMs;
  return { now: () => new Date(current), advance: (ms: number) => (current += ms) };
}

describe('comment thread/reply volume rate limiting (security review #2, WO-219)', () => {
  let pg: PgTestDb;
  const env = buildTestServerEnv();
  const AUTH_HOST = { host: new URL(env.publicUrl).host };
  const ORIGIN = env.publicUrl;
  const PASSWORD = 'correct-horse-battery-staple';

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

  async function makeCommenter(org: { id: string }, project: { id: string }) {
    const user = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: user.id, role: 'member' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'commenter')`, [project.id, user.id, org.id]);
    return user;
  }

  async function createDocument(app: ReturnType<typeof buildServer>, org: { slug: string }, project: { slug: string }, cookie: string): Promise<{ id: string; docId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/app/organizations/${org.slug}/projects/${project.slug}/documents`,
      headers: await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie),
      payload: { kind: 'PRD', title: 'Rate limited doc' },
    });
    expect(res.statusCode).toBe(200);
    return { id: res.json().document.id, docId: res.json().document.docId };
  }

  async function seedLiveBody(orgId: string, documentId: string, text: string): Promise<void> {
    const doc = new Y.Doc({ gc: false });
    doc.getText('body').insert(0, text);
    const update = Buffer.from(Y.encodeStateAsUpdate(doc));
    const { decodeUpdateRanges } = await import('@prdm/collab');
    const { structRanges, deleteRanges } = decodeUpdateRanges(update);
    await pg.ownerPool.query(
      `INSERT INTO doc_updates (org_id, document_id, seq, actor_kind, struct_ranges, delete_ranges, update) VALUES ($1, $2, 1, 'system', $3, $4, $5)`,
      [orgId, documentId, JSON.stringify(structRanges), JSON.stringify(deleteRanges), update],
    );
  }

  test('a client under the per-user limit is unaffected; exceeding it gets 429 until the window resets', async () => {
    const clock = fakeClock();
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, rateLimitStore: createClockStore(clock.now) });
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'admin')`, [project.id, owner.id, org.id]);
    const ownerCookie = await signIn(app, owner.email);
    const document = await createDocument(app, org, project, ownerCookie);
    await seedLiveBody(org.id, document.id, 'hello world');

    const commenter = await makeCommenter(org, project);
    const commenterCookie = await signIn(app, commenter.email);
    const base = `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/comments`;
    const headers = await mutationHeaders(app, AUTH_HOST, ORIGIN, commenterCookie);

    for (let i = 1; i <= COMMENT_RATE_LIMIT_CONFIG.maxPerUserPerMinute; i += 1) {
      const res = await app.inject({ method: 'POST', url: base, headers, payload: { startIndex: 0, endIndex: 5, body: `comment ${i}` } });
      expect(res.statusCode, `comment ${i} should not be rate-limited yet`).toBe(200);
    }

    const overLimit = await app.inject({ method: 'POST', url: base, headers, payload: { startIndex: 0, endIndex: 5, body: 'one too many' } });
    expect(overLimit.statusCode).toBe(429);
    expect(overLimit.json()).toEqual({ error: { code: 'rate_limited', message: 'rate limited' } });
    expect(overLimit.headers['retry-after']).toBeDefined();

    clock.advance(60_000 + 1);
    const afterWindow = await app.inject({ method: 'POST', url: base, headers, payload: { startIndex: 0, endIndex: 5, body: 'back within budget' } });
    expect(afterWindow.statusCode).toBe(200);

    await app.close();
  });

  test('the per-document limit blocks a brand new user once the document as a whole is over budget', async () => {
    const clock = fakeClock();
    const app = buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, rateLimitStore: createClockStore(clock.now) });
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const owner = await seedUser(env, pg.appPool, PASSWORD);
    await createMemberFixture(pg, { organizationId: org.id, userId: owner.id, role: 'owner' });
    await pg.ownerPool.query(`INSERT INTO "project_members" (project_id, user_id, org_id, role) VALUES ($1, $2, $3, 'admin')`, [project.id, owner.id, org.id]);
    const ownerCookie = await signIn(app, owner.email);
    const document = await createDocument(app, org, project, ownerCookie);
    await seedLiveBody(org.id, document.id, 'hello world');
    const base = `/api/app/organizations/${org.slug}/projects/${project.slug}/documents/${document.docId}/comments`;

    // Three separate commenters, each safely under their own per-user budget, together exactly exhaust
    // the document's shared per-document budget.
    const perUser = COMMENT_RATE_LIMIT_CONFIG.maxPerUserPerMinute;
    const commentersNeeded = Math.ceil(COMMENT_RATE_LIMIT_CONFIG.maxPerDocumentPerMinute / perUser);
    let remaining = COMMENT_RATE_LIMIT_CONFIG.maxPerDocumentPerMinute;
    for (let c = 0; c < commentersNeeded; c += 1) {
      const commenter = await makeCommenter(org, project);
      const cookie = await signIn(app, commenter.email);
      const headers = await mutationHeaders(app, AUTH_HOST, ORIGIN, cookie);
      const toSend = Math.min(perUser, remaining);
      for (let i = 0; i < toSend; i += 1) {
        const res = await app.inject({ method: 'POST', url: base, headers, payload: { startIndex: 0, endIndex: 5, body: `c${c}-${i}` } });
        expect(res.statusCode, `commenter ${c}, comment ${i} should not be rate-limited yet`).toBe(200);
      }
      remaining -= toSend;
    }
    expect(remaining).toBe(0);

    // A brand new, never-before-seen user — nowhere near their own per-user budget — is still blocked
    // because the document itself is over budget.
    const freshCommenter = await makeCommenter(org, project);
    const freshCookie = await signIn(app, freshCommenter.email);
    const freshHeaders = await mutationHeaders(app, AUTH_HOST, ORIGIN, freshCookie);
    const blocked = await app.inject({ method: 'POST', url: base, headers: freshHeaders, payload: { startIndex: 0, endIndex: 5, body: 'blocked by document budget' } });
    expect(blocked.statusCode).toBe(429);

    await app.close();
  });
});
