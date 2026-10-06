/**
 * `GET /api/app/profile`, `POST /api/app/profile/handle` (WO-432) and `POST /api/app/profile/work-profile`
 * (WO-542, SDD-051): set-once `user_profile.handle`,
 * the "dev:<handle>" actor identity `claim_work_order`/`complete_work_order`/`archive_work_order`
 * require. Global, not org/project-scoped -- `packages/server/src/api/profile.ts`'s own doc comment.
 */
import { Neo4jGraphDatabase } from '@prdm/core';
import { makeTmpDir, openTestPg, removeDir, testConfig, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { buildServer } from '../../src/build-server.js';
import { FakeMailer } from '../../src/mailer.js';
import { mutationHeaders } from '../helpers/csrf.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { seedUser } from '../helpers/seed-auth.js';

describe('GET /api/app/profile, POST /api/app/profile/handle (WO-432)', () => {
  let pg: PgTestDb;
  let neo4j: Neo4jGraphDatabase;
  let tmpRoot: string;
  let env: ReturnType<typeof buildTestServerEnv>;
  const AUTH_HOST = () => ({ host: new URL(env.publicUrl).host });
  const ORIGIN = () => env.publicUrl;
  const PASSWORD = 'correct-horse-battery-staple';

  beforeAll(async () => {
    pg = await openTestPg();
    tmpRoot = makeTmpDir();
    const config = testConfig(tmpRoot);
    neo4j = Neo4jGraphDatabase.connect(config.neo4j);
    await neo4j.verify();
    await neo4j.migrate();
    env = buildTestServerEnv({ neo4j: config.neo4j });
  });

  afterEach(async () => {
    await truncateAll(pg.ownerPool);
  });

  afterAll(async () => {
    await neo4j.close();
    removeDir(tmpRoot);
    await pg.close();
  });

  function buildApp() {
    return buildServer({ env, pool: pg.appPool, mailer: new FakeMailer(), logger: false, neo4j });
  }

  async function signIn(app: ReturnType<typeof buildServer>, email: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: AUTH_HOST() });
    const cookie = res.headers['set-cookie'];
    return (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  }

  test('GET reports handle: null before one is set', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    const res = await app.inject({ method: 'GET', url: '/api/app/profile', headers: { ...AUTH_HOST(), cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ handle: null, workProfile: null });

    await app.close();
  });

  test('POST sets the handle once, then GET reports it', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    const setRes = await app.inject({
      method: 'POST',
      url: '/api/app/profile/handle',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { handle: 'tano' },
    });
    expect(setRes.statusCode).toBe(200);
    expect(setRes.json()).toEqual({ handle: 'tano' });

    const getRes = await app.inject({ method: 'GET', url: '/api/app/profile', headers: { ...AUTH_HOST(), cookie } });
    expect(getRes.json()).toEqual({ handle: 'tano', workProfile: null });

    await app.close();
  });

  test('POST rejects a second attempt to set the handle with 409', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);
    const headers = await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie);

    await app.inject({ method: 'POST', url: '/api/app/profile/handle', headers, payload: { handle: 'first' } });
    const secondRes = await app.inject({ method: 'POST', url: '/api/app/profile/handle', headers, payload: { handle: 'second' } });

    expect(secondRes.statusCode).toBe(409);

    await app.close();
  });

  test('POST rejects a handle already taken by another user with 409', async () => {
    const app = buildApp();
    const first = await seedUser(env, pg.appPool, PASSWORD);
    const second = await seedUser(env, pg.appPool, PASSWORD);
    const firstCookie = await signIn(app, first.email);
    const secondCookie = await signIn(app, second.email);

    await app.inject({
      method: 'POST',
      url: '/api/app/profile/handle',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), firstCookie),
      payload: { handle: 'shared' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/app/profile/handle',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), secondCookie),
      payload: { handle: 'shared' },
    });

    expect(res.statusCode).toBe(409);

    await app.close();
  });

  test('POST rejects a handle outside the allowed charset with 400', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/app/profile/handle',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { handle: 'not valid!' },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });

  test('GET/POST are rejected without a session', async () => {
    const app = buildApp();

    const getRes = await app.inject({ method: 'GET', url: '/api/app/profile', headers: AUTH_HOST() });
    expect(getRes.statusCode).toBe(401);

    await app.close();
  });

  // ---- WO-542 (SDD-051/PRD-033 R1): the work profile the Planta's entry band remembers ----

  test('WO-542: GET reports workProfile: null until one is chosen, without needing a handle', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    const res = await app.inject({ method: 'GET', url: '/api/app/profile', headers: { ...AUTH_HOST(), cookie } });

    expect(res.json()).toEqual({ handle: null, workProfile: null });

    await app.close();
  });

  test('WO-542: POST work-profile stores the choice and the very next GET carries it, in the same read as the handle', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    const setRes = await app.inject({
      method: 'POST',
      url: '/api/app/profile/work-profile',
      headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
      payload: { workProfile: 'producto' },
    });
    expect(setRes.statusCode).toBe(200);
    expect(setRes.json()).toEqual({ workProfile: 'producto' });

    const getRes = await app.inject({ method: 'GET', url: '/api/app/profile', headers: { ...AUTH_HOST(), cookie } });
    expect(getRes.json()).toEqual({ handle: null, workProfile: 'producto' });

    await app.close();
  });

  test('WO-542: unlike the handle, the work profile is meant to change: a second POST replaces it, no 409', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    for (const workProfile of ['negocio', 'developer']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/app/profile/work-profile',
        headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
        payload: { workProfile },
      });
      expect(res.statusCode).toBe(200);
    }

    const getRes = await app.inject({ method: 'GET', url: '/api/app/profile', headers: { ...AUTH_HOST(), cookie } });
    expect(getRes.json()).toEqual({ handle: null, workProfile: 'developer' });

    await app.close();
  });

  test('WO-542: setting a work profile and setting a handle do not interfere with each other', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    await app.inject({ method: 'POST', url: '/api/app/profile/work-profile', headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie), payload: { workProfile: 'developer' } });
    const handleRes = await app.inject({ method: 'POST', url: '/api/app/profile/handle', headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie), payload: { handle: 'lucia' } });
    expect(handleRes.statusCode).toBe(200);

    const getRes = await app.inject({ method: 'GET', url: '/api/app/profile', headers: { ...AUTH_HOST(), cookie } });
    expect(getRes.json()).toEqual({ handle: 'lucia', workProfile: 'developer' });

    await app.close();
  });

  test('WO-542: POST work-profile rejects a value outside the three profiles with 400', async () => {
    const app = buildApp();
    const user = await seedUser(env, pg.appPool, PASSWORD);
    const cookie = await signIn(app, user.email);

    for (const payload of [{ workProfile: 'gerente' }, { workProfile: '' }, {}, { workProfile: 42 }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/app/profile/work-profile',
        headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookie),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }

    await app.close();
  });

  test('WO-542: POST work-profile is rejected without a session', async () => {
    const app = buildApp();

    const res = await app.inject({ method: 'POST', url: '/api/app/profile/work-profile', headers: AUTH_HOST(), payload: { workProfile: 'negocio' } });
    expect([401, 403]).toContain(res.statusCode);

    await app.close();
  });

  test('WO-542: each person only ever sees and changes their own work profile', async () => {
    const app = buildApp();
    const a = await seedUser(env, pg.appPool, PASSWORD);
    const b = await seedUser(env, pg.appPool, PASSWORD);
    const cookieA = await signIn(app, a.email);
    const cookieB = await signIn(app, b.email);

    await app.inject({ method: 'POST', url: '/api/app/profile/work-profile', headers: await mutationHeaders(app, AUTH_HOST(), ORIGIN(), cookieA), payload: { workProfile: 'negocio' } });

    const forB = await app.inject({ method: 'GET', url: '/api/app/profile', headers: { ...AUTH_HOST(), cookie: cookieB } });
    expect(forB.json()).toEqual({ handle: null, workProfile: null });

    await app.close();
  });
});
