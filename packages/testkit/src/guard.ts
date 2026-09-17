/**
 * WO-407 (PRD-008 §4.1 / SDD-016): `unit-node`/`unit-jsdom` (the only vitest projects CI runs) set
 * `PRDM_TEST_NO_DB=1` (see `vitest.config.ts`) so a test that needs a real Neo4j/Postgres can never pass
 * — or silently hang — under `npm run test:unit` just because it landed in the wrong directory.
 * `openTestDb`/`openTestPg` (and any harness that opens a database connection on its own, without going
 * through them) call this first, so the failure is an immediate, actionable error instead of a confusing
 * connection timeout.
 */
export function assertDbAllowed(): void {
  if (process.env.PRDM_TEST_NO_DB !== '1') return;
  throw new Error(
    'This test opens a real database connection, but PRDM_TEST_NO_DB=1 (set for the unit-node/unit-jsdom ' +
      'vitest projects — see vitest.config.ts). Move this test out of `tests/unit` into a db-suite directory ' +
      '(e.g. `tests/integration`) so it only runs against a real Neo4j/Postgres instance.',
  );
}
