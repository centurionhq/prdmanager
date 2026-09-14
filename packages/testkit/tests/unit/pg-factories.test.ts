import { describe, expect, test } from 'vitest';
import { createProjectFixture } from '../../src/pg-factories.js';
import type { PgTestDb } from '../../src/pg.js';

// `createOrganizationFixture`/`createUserFixture` are exercised against a real Postgres test instance
// in `packages/db/tests/integration/auth-schema.test.ts` (WO-092) now that those tables exist.
// `createProjectFixture` is still a placeholder until `projects` lands (WO-098), so it runs without a
// Postgres connection — `undefined` stands in for `PgTestDb`.
const NO_DB = undefined as unknown as PgTestDb;

describe('placeholder Postgres fixtures (WO-090/WO-092)', () => {
  test('createProjectFixture rejects until the projects table exists', async () => {
    await expect(createProjectFixture(NO_DB)).rejects.toThrow(/does not exist yet/i);
  });
});
