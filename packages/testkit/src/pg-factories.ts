import type { PgTestDb } from './pg.js';

/**
 * Minimal typed placeholders for SDD-006's `organizations`, `user_profile` and `projects` tables, none of
 * which exist yet (WO-090 only scaffolds the Postgres harness itself). The shape and factory signature are
 * fixed now so integration tests written against them today don't change shape once a later work order adds
 * the real tables and swaps each function body for an actual `INSERT ... RETURNING`.
 */
export interface OrganizationFixture {
  id: string;
  name: string;
  slug: string;
}

export interface UserFixture {
  id: string;
  email: string;
  /** `dev:<handle>` must satisfy `ACTOR_PATTERN` from `@prdm/core` once wired (SDD-006 §Modelo de datos). */
  handle: string;
}

export interface ProjectFixture {
  id: string;
  orgId: string;
  name: string;
  slug: string;
}

const notYetImplemented = (factory: string, table: string): Error =>
  new Error(`${factory}: the "${table}" table does not exist yet (SDD-006, later work order)`);

export function createOrganizationFixture(_pg: PgTestDb, _overrides: Partial<OrganizationFixture> = {}): Promise<OrganizationFixture> {
  return Promise.reject(notYetImplemented('createOrganizationFixture', 'organizations'));
}

export function createUserFixture(_pg: PgTestDb, _overrides: Partial<UserFixture> = {}): Promise<UserFixture> {
  return Promise.reject(notYetImplemented('createUserFixture', 'user_profile'));
}

export function createProjectFixture(_pg: PgTestDb, _overrides: Partial<ProjectFixture> = {}): Promise<ProjectFixture> {
  return Promise.reject(notYetImplemented('createProjectFixture', 'projects'));
}
