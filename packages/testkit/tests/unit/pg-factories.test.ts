import { describe, expect, test } from 'vitest';
import { createOrganizationFixture, createProjectFixture, createUserFixture } from '../../src/pg-factories.js';
import type { PgTestDb } from '../../src/pg.js';

// Placeholders never touch a database (SDD-006's organizations/user_profile/projects tables land in a
// later work order), so these run without a Postgres connection — `undefined` stands in for `PgTestDb`.
const NO_DB = undefined as unknown as PgTestDb;

describe('placeholder Postgres fixtures (WO-090)', () => {
  test('createOrganizationFixture rejects until the organizations table exists', async () => {
    await expect(createOrganizationFixture(NO_DB)).rejects.toThrow(/organizations.*does not exist yet/i);
  });

  test('createUserFixture rejects until the user_profile table exists', async () => {
    await expect(createUserFixture(NO_DB)).rejects.toThrow(/does not exist yet/i);
  });

  test('createProjectFixture rejects until the projects table exists', async () => {
    await expect(createProjectFixture(NO_DB)).rejects.toThrow(/does not exist yet/i);
  });
});
