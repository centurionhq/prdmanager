#!/usr/bin/env node
/**
 * PRD-008 §4.2 (WO-401): `npm run test:services`. Brings up the local Neo4j/Postgres test containers
 * (`docker compose --profile test`) and waits for both healthchecks to pass before exiting — `docker
 * compose up --wait` (Compose v2.1.1+) already does exactly this and exits non-zero on timeout/unhealthy,
 * so this script is a thin, documented entry point rather than reimplementing healthcheck polling.
 * Idempotent: if both containers are already up and healthy, `--wait` returns immediately.
 *
 * `postgres-test` mounts the same `docker/postgres/init/01-roles.sh` bootstrap as the dev `postgres`
 * service (`docker-compose.yml`), and since it runs on a `tmpfs` volume it reinitializes — and re-runs
 * that bootstrap — on every fresh container start, so there is nothing extra for this script to apply.
 *
 * Usage: node scripts/test-services.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_FILE = resolve(ROOT, '.env');

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const result = spawnSync('docker', ['compose', '--profile', 'test', 'up', '-d', '--wait', 'neo4j-test', 'postgres-test'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`test:services: failed to run docker compose (${result.error.message})`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error('test:services: neo4j-test and/or postgres-test did not become healthy in time.');
  process.exit(result.status ?? 1);
}
console.log('test:services: neo4j-test (7688) and postgres-test (5433) are up and healthy.');
