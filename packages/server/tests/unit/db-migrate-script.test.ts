import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// WO-215 / SDD-006 "Local y despliegue": the screenshot walkthrough in this session found that a fresh
// Postgres has no migrations applied unless someone thinks to run drizzle-kit by hand — only test
// harnesses (packages/testkit/src/pg.ts) auto-migrate. `npm run db:migrate` at the root is the documented,
// discoverable fix; this test pins that it exists and actually delegates to @prdm/db's own migrate script
// (drizzle-kit migrate), not some other command that would silently do nothing.

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function readPackageJson(relativePath: string): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(new URL(relativePath, `file://${REPO_ROOT}`), 'utf8'));
}

describe('npm run db:migrate', () => {
  test('root package.json declares db:migrate delegating to the @prdm/db workspace', () => {
    const root = readPackageJson('package.json');
    expect(root.scripts?.['db:migrate']).toBe('npm run db:migrate --workspace=@prdm/db');
  });

  test('@prdm/db package.json db:migrate script runs drizzle-kit migrate', () => {
    const db = readPackageJson('packages/db/package.json');
    expect(db.scripts?.['db:migrate']).toBe('drizzle-kit migrate');
  });
});
