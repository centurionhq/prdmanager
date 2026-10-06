/**
 * SDD-099 §D1 — `access_request`: org-scoped (RLS enabled+forced) repository for "pedir acceso a una
 * organización". Runs against the real test Postgres so the policy and the `prdm_app` grants are exercised.
 */
import {
  AccessRequestAlreadyResolvedError,
  AccessRequestNotFoundError,
  createAccessRequest,
  listPendingAccessRequests,
  resolveAccessRequest,
} from '@prdm/db';
import { createOrganizationFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

describe('access requests (SDD-099)', () => {
  test('createAccessRequest normalizes the email, stores name/message and is born pending', async () => {
    const org = await createOrganizationFixture(pg);

    const created = await createAccessRequest(pg.appPool, { orgId: org.id, email: ' Ada@Example.TEST ', name: ' Ada ', message: ' hola ' });

    expect(created).toMatchObject({ email: 'ada@example.test', name: 'Ada', message: 'hola', status: 'pending', resolvedAt: null, resolvedBy: null });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created).not.toHaveProperty('orgId');
  });

  test('absent or empty name/message are stored as NULL', async () => {
    const org = await createOrganizationFixture(pg);

    await createAccessRequest(pg.appPool, { orgId: org.id, email: 'a@example.test' });
    await createAccessRequest(pg.appPool, { orgId: org.id, email: 'b@example.test', name: '', message: '  ' });

    const { rows } = await pg.ownerPool.query('SELECT name, message FROM access_request');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toEqual({ name: null, message: null });
  });

  test('RLS hides other organizations\' requests and everything when app.org_id is unset', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    await createAccessRequest(pg.appPool, { orgId: orgA.id, email: 'a@example.test' });
    await createAccessRequest(pg.appPool, { orgId: orgB.id, email: 'b1@example.test' });
    await createAccessRequest(pg.appPool, { orgId: orgB.id, email: 'b2@example.test' });

    const client = await pg.appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgA.id]);
      const scoped = await client.query('SELECT count(*)::int AS n FROM access_request');
      await client.query('COMMIT');
      expect(scoped.rows[0].n).toBe(1);

      const unscoped = await client.query('SELECT count(*)::int AS n FROM access_request');
      expect(unscoped.rows[0].n).toBe(0);
    } finally {
      client.release();
    }

    const listed = await listPendingAccessRequests(pg.appPool, orgA.id);
    expect(listed.map((r) => r.email)).toEqual(['a@example.test']);
  });

  test('listPendingAccessRequests returns only pending ones, oldest first', async () => {
    const org = await createOrganizationFixture(pg);
    const first = await createAccessRequest(pg.appPool, { orgId: org.id, email: 'first@example.test' });
    const second = await createAccessRequest(pg.appPool, { orgId: org.id, email: 'second@example.test' });
    const third = await createAccessRequest(pg.appPool, { orgId: org.id, email: 'third@example.test' });
    const done = await createAccessRequest(pg.appPool, { orgId: org.id, email: 'done@example.test' });
    // Insert order is not creation order: force a known created_at sequence (third < first < second).
    const times: Array<[string, string]> = [
      [third.id, '2026-01-01T00:00:00Z'],
      [first.id, '2026-01-02T00:00:00Z'],
      [second.id, '2026-01-03T00:00:00Z'],
      [done.id, '2025-01-01T00:00:00Z'],
    ];
    for (const [id, at] of times) await pg.ownerPool.query('UPDATE access_request SET created_at = $2 WHERE id = $1', [id, at]);
    await resolveAccessRequest(pg.appPool, { orgId: org.id, id: done.id, status: 'rejected', resolvedBy: 'user_x' });

    const listed = await listPendingAccessRequests(pg.appPool, org.id);

    expect(listed.map((r) => r.email)).toEqual(['third@example.test', 'first@example.test', 'second@example.test']);
  });

  test('resolveAccessRequest approved sets status/resolvedAt/resolvedBy and drops it from the pending list', async () => {
    const org = await createOrganizationFixture(pg);
    const created = await createAccessRequest(pg.appPool, { orgId: org.id, email: 'a@example.test' });

    const resolved = await resolveAccessRequest(pg.appPool, { orgId: org.id, id: created.id, status: 'approved', resolvedBy: 'user_admin' });

    expect(resolved).toMatchObject({ id: created.id, status: 'approved', resolvedBy: 'user_admin' });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(await listPendingAccessRequests(pg.appPool, org.id)).toEqual([]);
  });

  test('resolveAccessRequest on another organization\'s request throws AccessRequestNotFoundError', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const inB = await createAccessRequest(pg.appPool, { orgId: orgB.id, email: 'b@example.test' });

    await expect(resolveAccessRequest(pg.appPool, { orgId: orgA.id, id: inB.id, status: 'approved', resolvedBy: 'user_admin' })).rejects.toBeInstanceOf(
      AccessRequestNotFoundError,
    );
  });

  test('resolving twice throws AccessRequestAlreadyResolvedError and leaves the state untouched', async () => {
    const org = await createOrganizationFixture(pg);
    const created = await createAccessRequest(pg.appPool, { orgId: org.id, email: 'a@example.test' });
    await resolveAccessRequest(pg.appPool, { orgId: org.id, id: created.id, status: 'approved', resolvedBy: 'user_one' });

    await expect(resolveAccessRequest(pg.appPool, { orgId: org.id, id: created.id, status: 'rejected', resolvedBy: 'user_two' })).rejects.toBeInstanceOf(
      AccessRequestAlreadyResolvedError,
    );

    const { rows } = await pg.ownerPool.query('SELECT status, resolved_by FROM access_request WHERE id = $1', [created.id]);
    expect(rows[0]).toEqual({ status: 'approved', resolved_by: 'user_one' });
  });

  test('status rejected marks the request rejected', async () => {
    const org = await createOrganizationFixture(pg);
    const created = await createAccessRequest(pg.appPool, { orgId: org.id, email: 'a@example.test' });

    const resolved = await resolveAccessRequest(pg.appPool, { orgId: org.id, id: created.id, status: 'rejected', resolvedBy: 'user_admin' });

    expect(resolved.status).toBe('rejected');
  });
});
