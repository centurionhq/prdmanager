import { createHash } from 'node:crypto';

export interface Migration {
  version: number;
  name: string;
  /** Destructive migrations may delete data and only run via explicit `prdm db migrate` (ADR-002 D3). */
  destructive: boolean;
  /** Each statement runs as its own auto-commit query, in order; some use `CALL ... IN TRANSACTIONS`, which requires auto-commit (no open transaction). */
  statements: readonly string[];
}

const V1_STATEMENTS: readonly string[] = [
  'CREATE CONSTRAINT node_id IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT coderef_key IF NOT EXISTS FOR (c:CodeRef) REQUIRE c.key IS UNIQUE',
  'CREATE CONSTRAINT commit_sha IF NOT EXISTS FOR (c:Commit) REQUIRE c.sha IS UNIQUE',
  'CREATE CONSTRAINT actor_id IF NOT EXISTS FOR (a:Actor) REQUIRE a.id IS UNIQUE',
  'CREATE INDEX node_status IF NOT EXISTS FOR (n:Node) ON (n.status)',
  'CREATE INDEX node_kind IF NOT EXISTS FOR (n:Node) ON (n.kind)',
  'CREATE FULLTEXT INDEX node_text IF NOT EXISTS FOR (n:Node) ON EACH [n.title, n.body, n.tags_text]',
];

/**
 * Multi-project isolation (SDD-002 "Grafo multi-proyecto", ADR-002 D2/D4/D5): backfills nothing (the graph is
 * derived; `prdm sync` regenerates it), drops the old single-project constraints/indexes, deletes any Node,
 * CodeRef, Commit or Actor left without a `project_id` and replaces uniqueness with `(project_id, ...)` composites.
 */
const V2_STATEMENTS: readonly string[] = [
  'CREATE CONSTRAINT schema_migration_version IF NOT EXISTS FOR (m:SchemaMigration) REQUIRE m.version IS UNIQUE',
  'CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE',
  'MATCH (n) WHERE (n:Node OR n:CodeRef OR n:Commit OR n:Actor) AND n.project_id IS NULL CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 1000 ROWS',
  'DROP CONSTRAINT node_id IF EXISTS',
  'DROP CONSTRAINT coderef_key IF EXISTS',
  'DROP CONSTRAINT commit_sha IF EXISTS',
  'DROP CONSTRAINT actor_id IF EXISTS',
  'DROP INDEX node_status IF EXISTS',
  'DROP INDEX node_kind IF EXISTS',
  'DROP INDEX node_text IF EXISTS',
  'CREATE CONSTRAINT node_project_id IF NOT EXISTS FOR (n:Node) REQUIRE (n.project_id, n.id) IS UNIQUE',
  'CREATE CONSTRAINT coderef_project_key IF NOT EXISTS FOR (c:CodeRef) REQUIRE (c.project_id, c.key) IS UNIQUE',
  'CREATE CONSTRAINT commit_project_sha IF NOT EXISTS FOR (c:Commit) REQUIRE (c.project_id, c.sha) IS UNIQUE',
  'CREATE CONSTRAINT actor_project_id IF NOT EXISTS FOR (a:Actor) REQUIRE (a.project_id, a.id) IS UNIQUE',
  'CREATE INDEX node_project_id_idx IF NOT EXISTS FOR (n:Node) ON (n.project_id)',
  'CREATE INDEX coderef_project_id_idx IF NOT EXISTS FOR (c:CodeRef) ON (c.project_id)',
  'CREATE INDEX commit_project_id_idx IF NOT EXISTS FOR (c:Commit) ON (c.project_id)',
  'CREATE INDEX actor_project_id_idx IF NOT EXISTS FOR (a:Actor) ON (a.project_id)',
  'CREATE INDEX node_project_status IF NOT EXISTS FOR (n:Node) ON (n.project_id, n.status)',
  'CREATE FULLTEXT INDEX node_text_v2 IF NOT EXISTS FOR (n:Node) ON EACH [n.title, n.body, n.tags_text, n.project_id]',
];

/** Ordered, versioned schema migrations (ADR-002 D3). Version 1 is the PRD-001 schema; version 2 adds multi-project isolation. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial_schema', destructive: false, statements: V1_STATEMENTS },
  { version: 2, name: 'multi_project', destructive: true, statements: V2_STATEMENTS },
];

/** Deterministic checksum of a migration's statements; a stored checksum that no longer matches this build is an error (ADR-002 D3). */
export function checksumOf(statements: readonly string[]): string {
  return createHash('sha256').update(statements.join('\n')).digest('hex');
}

/** Name of the legacy (pre-migrations) unique constraint used to detect an already-applied v1 schema with no `SchemaMigration` bookkeeping. */
export const LEGACY_V1_CONSTRAINT_NAME = 'node_id';
