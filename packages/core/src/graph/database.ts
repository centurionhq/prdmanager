import neo4j, { type Driver } from 'neo4j-driver';
import type { Neo4jConfig } from '../config.js';
import { assertProjectId, type ProjectRef } from '../project/types.js';
import { checksumOf, LEGACY_V1_CONSTRAINT_NAME, MIGRATIONS } from './migrations.js';
import { Neo4jGraphStore } from './store.js';
import type { GraphDatabase, ProjectRecord, SchemaStatus } from './types.js';

const EXPECTED_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
const ORPHAN_LABELS = ['Node', 'CodeRef', 'Commit', 'Actor'] as const;

interface AppliedMigration {
  name: string;
  checksum: string;
}

/**
 * Owns the driver, schema migrations and the project registry (ADR-002 D1/D3). `forProject` is the only way to
 * get a `GraphStore`, so no query anywhere can omit the project filter.
 */
export class Neo4jGraphDatabase implements GraphDatabase {
  private constructor(
    private readonly driver: Driver,
    private readonly database: string,
  ) {}

  static connect(config: Neo4jConfig): Neo4jGraphDatabase {
    const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password), {
      disableLosslessIntegers: true,
      maxConnectionPoolSize: 20,
    });
    return new Neo4jGraphDatabase(driver, config.database);
  }

  async verify(): Promise<void> {
    await this.driver.verifyConnectivity({ database: this.database });
  }

  /**
   * Runs one statement as a true auto-commit query via `session.run` (implicit transaction). `driver.executeQuery`
   * wraps queries in a managed (explicit) transaction, which `CALL ... IN TRANSACTIONS` rejects — migrations and
   * `dropProject` need auto-commit, and admin/schema queries don't need `executeQuery`'s retry semantics anyway.
   */
  private async run(query: string, params: Record<string, unknown> = {}): Promise<{ records: import('neo4j-driver').Record[] }> {
    const session = this.driver.session({ database: this.database });
    try {
      return await session.run(query, params);
    } finally {
      await session.close();
    }
  }

  private async appliedMigrations(): Promise<Map<number, AppliedMigration>> {
    const { records } = await this.run('MATCH (m:SchemaMigration) RETURN m.version AS version, m.name AS name, m.checksum AS checksum');
    return new Map(records.map((r) => [r.get('version') as number, { name: r.get('name') as string, checksum: r.get('checksum') as string }]));
  }

  /** A DB migrated by PRD-001 has the old single-project constraints but no `SchemaMigration` bookkeeping yet. */
  private async legacyV1Applied(): Promise<boolean> {
    const { records } = await this.run('SHOW CONSTRAINTS YIELD name WHERE name = $name RETURN count(*) AS total', { name: LEGACY_V1_CONSTRAINT_NAME });
    return (records[0]?.get('total') as number) > 0;
  }

  async schemaStatus(): Promise<SchemaStatus> {
    const applied = await this.appliedMigrations();
    let current = applied.size > 0 ? Math.max(...applied.keys()) : 0;
    if (current === 0 && (await this.legacyV1Applied())) current = 1;
    const pending = MIGRATIONS.filter((m) => m.version > current).map((m) => ({ version: m.version, name: m.name, destructive: m.destructive }));
    return { current, expected: EXPECTED_SCHEMA_VERSION, pending };
  }

  async migrate(): Promise<SchemaStatus> {
    const applied = await this.appliedMigrations();
    const legacyV1 = applied.size === 0 && (await this.legacyV1Applied());
    for (const migration of MIGRATIONS) {
      await this.applyMigration(migration, applied.get(migration.version), legacyV1 && migration.version === 1);
    }
    return this.schemaStatus();
  }

  private async applyMigration(migration: (typeof MIGRATIONS)[number], existing: AppliedMigration | undefined, recordOnlyLegacy: boolean): Promise<void> {
    const checksum = checksumOf(migration.statements);
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`schema migration ${migration.version} (${migration.name}) is applied with a different checksum than this build expects; refusing to run`);
      }
      return;
    }
    if (!recordOnlyLegacy) {
      for (const statement of migration.statements) await this.run(statement);
      await this.run('CALL db.awaitIndexes(120)');
    }
    await this.run('CREATE (:SchemaMigration {version: $version, name: $name, checksum: $checksum, applied_at: $appliedAt})', {
      version: migration.version,
      name: migration.name,
      checksum,
      appliedAt: new Date().toISOString(),
    });
  }

  async assertSchemaCurrent(): Promise<void> {
    const status = await this.schemaStatus();
    if (status.current !== status.expected) {
      throw new Error(`graph schema is at version ${status.current}, this build expects version ${status.expected}; run \`prdm db migrate\``);
    }
  }

  forProject(project: ProjectRef): Neo4jGraphStore {
    assertProjectId(project.id);
    return new Neo4jGraphStore(this.driver, this.database, project);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const { records } = await this.run(
      `MATCH (p:Project)
       OPTIONAL MATCH (n) WHERE (n:Node OR n:CodeRef OR n:Commit OR n:Actor) AND n.project_id = p.id
       RETURN p.id AS id, p.name AS name, p.root_fingerprint AS rootFingerprint, p.updated_at AS updatedAt, count(n) AS nodeCount
       ORDER BY p.id`,
    );
    return records.map((r) => ({
      id: r.get('id') as string,
      name: r.get('name') as string,
      rootFingerprint: r.get('rootFingerprint') as string,
      updatedAt: (r.get('updatedAt') as string | null) ?? null,
      nodeCount: r.get('nodeCount') as number,
    }));
  }

  async claimProject(project: ProjectRef): Promise<void> {
    assertProjectId(project.id);
    await this.run('MERGE (p:Project {id: $id}) SET p.name = $name, p.root_fingerprint = $root, p.updated_at = $updatedAt', {
      id: project.id,
      name: project.name,
      root: project.root,
      updatedAt: new Date().toISOString(),
    });
  }

  async dropProject(projectId: string): Promise<void> {
    assertProjectId(projectId);
    await this.run(
      'MATCH (n) WHERE (n:Node OR n:CodeRef OR n:Commit OR n:Actor) AND n.project_id = $projectId CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 1000 ROWS',
      { projectId },
    );
    await this.run('MATCH (p:Project {id: $projectId}) DETACH DELETE p', { projectId });
  }

  async orphanCounts(): Promise<{ label: string; count: number }[]> {
    const { records } = await this.run(
      `UNWIND $labels AS label
       CALL (label) { MATCH (n) WHERE label IN labels(n) AND n.project_id IS NULL RETURN count(n) AS count }
       RETURN label, count`,
      { labels: ORPHAN_LABELS },
    );
    return records.map((r) => ({ label: r.get('label') as string, count: r.get('count') as number }));
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
