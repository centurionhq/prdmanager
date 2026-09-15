/**
 * `nextDocId` (SDD-007 "Documentos y flujo" / "Id al crear"; WO-131): a row-locked, per-project id
 * counter. Runs against the real test Postgres instance so the row lock (an `UPDATE ... RETURNING`
 * inside `withTenantTx`) is exercised with genuinely concurrent transactions, not sequential awaits.
 */
import { nextDocId, withTenantTx } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
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

describe('nextDocId (WO-131)', () => {
  test('formats the first id as KIND-001, zero-padded to 3 digits', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    const id = await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'PRD'));
    expect(id).toBe('PRD-001');
  });

  test('seeds the counter from existingMaxSeq on first use, then increments normally', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    const first = await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'PRD', 5));
    expect(first).toBe('PRD-006');
    const second = await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'PRD', 5));
    expect(second).toBe('PRD-007');
  });

  test('existingMaxSeq is only used to seed: it has no effect once the counter row already exists', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'FR'));
    // A later caller passing a much larger existingMaxSeq must not jump the counter forward or reset it.
    const id = await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'FR', 999));
    expect(id).toBe('FR-002');
  });

  test('two different kinds in the same project have independent counters', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    const prd = await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'PRD'));
    const fr = await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'FR'));
    expect(prd).toBe('PRD-001');
    expect(fr).toBe('FR-001');
  });

  test('two different projects have independent counters for the same kind', async () => {
    const org = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: org.id });
    const projectB = await createProjectFixture(pg, { orgId: org.id });

    const a = await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, projectA.id, 'PRD'));
    const b = await withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, projectB.id, 'PRD'));
    expect(a).toBe('PRD-001');
    expect(b).toBe('PRD-001');
  });

  test('N genuinely concurrent transactions for the same (project, kind) each get a unique id, with no duplicates', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });
    const CONCURRENCY = 8;

    // Fired together (no sequential await between them) so they race for real on the row lock; each
    // uses its own pooled connection/transaction via withTenantTx, exactly like independent requests would.
    const ids = await Promise.all(Array.from({ length: CONCURRENCY }, () => withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'WO'))));

    expect(new Set(ids).size).toBe(CONCURRENCY); // no duplicates
    for (const id of ids) expect(id).toMatch(/^WO-\d{3}$/);
    // The row lock also means no assignment is skipped when every transaction commits successfully: 1..N with no gaps here (gaps are only expected from aborted transactions, SDD-007).
    const seqs = ids.map((id) => Number(id.split('-')[1])).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
  });

  test('a transaction that reserves an id and then rolls back leaves the counter exactly as if it never ran (the row lock is released and the increment undone with it)', async () => {
    const org = await createOrganizationFixture(pg);
    const project = await createProjectFixture(pg, { orgId: org.id });

    // One transaction reserves and rolls back; a concurrent one reserves and commits. Whichever runs
    // first, exactly one increment must survive: the aborted one's reservation was never actually
    // attached to a document, so id_counters must show it was never persisted (no double-increment,
    // no residual lock left held).
    const rolledBack = withTenantTx(pg.appPool, org.id, async (tx) => {
      const id = await nextDocId(tx, project.id, 'ART');
      throw new Error(`discard ${id}`);
    }).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));

    const committed = withTenantTx(pg.appPool, org.id, (tx) => nextDocId(tx, project.id, 'ART'));

    const [discardMessage, committedId] = await Promise.all([rolledBack, committed]);
    expect(discardMessage).toMatch(/^discard ART-\d{3}$/);
    expect(committedId).toMatch(/^ART-\d{3}$/);

    const { rows } = await pg.ownerPool.query<{ last_seq: number }>('SELECT last_seq FROM id_counters WHERE project_id = $1 AND kind = $2', [project.id, 'ART']);
    expect(rows).toEqual([{ last_seq: 1 }]); // exactly one committed increment, regardless of which transaction ran first
  });
});
