#!/usr/bin/env node
/**
 * PRD-008 §4.2 (WO-401): `npm run test:services:check`. Exits 0 only if both the Neo4j and Postgres test
 * instances are reachable with the credentials in `.env` (`NEO4J_TEST_URI`, `DATABASE_TEST_URL`,
 * `DATABASE_TEST_MIGRATION_URL`) — the same three variables `packages/testkit/src/db.ts` and `pg.ts`
 * already read. Used by the pre-commit/pre-push hooks (SDD-017 §4.3/4.4) to fail fast with an actionable
 * message instead of letting a test file hang or error obscurely.
 *
 * Usage: node scripts/check-test-services.mjs
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';
import pg from 'pg';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_FILE = resolve(ROOT, '.env');

if ((!process.env.NEO4J_TEST_URI || !process.env.DATABASE_TEST_URL) && existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

async function checkNeo4j() {
  const uri = process.env.NEO4J_TEST_URI ?? 'neo4j://127.0.0.1:7688';
  const password = process.env.NEO4J_PASSWORD;
  if (!password) return `NEO4J_PASSWORD is not set (see .env.example)`;
  const driver = neo4j.driver(uri, neo4j.auth.basic('neo4j', password));
  try {
    await driver.verifyConnectivity();
    return null;
  } catch (err) {
    return `neo4j-test unreachable at ${uri}: ${err.message}`;
  } finally {
    await driver.close();
  }
}

async function checkPostgres(name, envVar) {
  const connectionString = process.env[envVar];
  if (!connectionString) return `${envVar} is not set (see .env.example)`;
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await pool.query('SELECT 1');
    return null;
  } catch (err) {
    return `${name} unreachable via ${envVar}: ${err.message}`;
  } finally {
    await pool.end();
  }
}

async function main() {
  const [neo4jError, appError, migrationError] = await Promise.all([
    checkNeo4j(),
    checkPostgres('postgres-test (prdm_app)', 'DATABASE_TEST_URL'),
    checkPostgres('postgres-test (prdm_owner)', 'DATABASE_TEST_MIGRATION_URL'),
  ]);
  const errors = [neo4jError, appError, migrationError].filter((e) => e !== null);

  if (errors.length === 0) {
    console.log('test:services:check: neo4j-test and postgres-test are both reachable.');
    return;
  }
  console.error('test:services:check: some test services are not reachable:');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('Run "npm run test:services" to start them.');
  process.exitCode = 1;
}

await main();
