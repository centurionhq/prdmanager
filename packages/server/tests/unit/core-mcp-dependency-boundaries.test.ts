/**
 * WO-247 (final PRD-005-wide review, LOW/preventive): ADR-006's own architecture requires the dependency
 * direction `core ← mcp ← server` — `packages/core` and `packages/mcp` must never import from
 * `@prdm/db`, `@prdm/server`, or `@prdm/app` (the SaaS-only packages built on top of them), so the
 * local-only CLI/MCP tool keeps working without any of the SaaS platform's dependencies. This has held
 * so far purely by contributor discipline (confirmed clean by the review's own grep) — this test makes it
 * a real, self-contained regression guard rather than relying on that discipline continuing to hold, with
 * no new lint tool/config to introduce and maintain (this repo has no ESLint/dependency-cruiser setup at
 * all today; one dedicated meta-test is the smaller footprint for one architectural invariant, matching
 * `packages/app/tests/unit/no-core-value-import.test.ts`'s own precedent for this exact kind of check).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_SPECIFIERS = ['@prdm/db', '@prdm/server', '@prdm/app'] as const;

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const GUARDED_PACKAGE_SRC_DIRS = [join(REPO_ROOT, 'packages', 'core', 'src'), join(REPO_ROOT, 'packages', 'mcp', 'src')];

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

/** Matches any static `import`/`export ... from '<specifier>'`, dynamic `import('<specifier>')`, or bare
 * `require('<specifier>')` — deliberately broader than `no-core-value-import.test.ts`'s type-only carve-out:
 * `core`/`mcp` may not depend on these packages even for types, since the whole point is that they must
 * build and run with none of the SaaS platform's packages present at all. */
function findForbiddenImports(content: string): string[] {
  const offenders: string[] = [];
  for (const specifier of FORBIDDEN_SPECIFIERS) {
    const escaped = specifier.replace(/[/]/g, '\\/');
    const staticPattern = new RegExp(`\\b(?:import|export)\\b[^;]*?\\bfrom\\s+(['"])${escaped}\\1`, 'g');
    const callPattern = new RegExp(`\\b(?:import|require)\\s*\\(\\s*(['"])${escaped}\\1\\s*\\)`, 'g');
    for (const match of content.matchAll(staticPattern)) offenders.push(match[0].replace(/\s+/g, ' ').trim());
    for (const match of content.matchAll(callPattern)) offenders.push(match[0]);
  }
  return offenders;
}

describe('packages/core and packages/mcp never depend on @prdm/db, @prdm/server or @prdm/app (ADR-006)', () => {
  it('no source file in either package imports/requires a forbidden specifier', () => {
    const files = GUARDED_PACKAGE_SRC_DIRS.flatMap(collectSourceFiles);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) => findForbiddenImports(readFileSync(file, 'utf8')).map((offense) => `${file}: ${offense}`));

    expect(offenders).toEqual([]);
  });

  it('still flags a genuine forbidden import (static, dynamic, and require)', () => {
    const content = [
      "import { buildServer } from '@prdm/server';",
      "export { createTenantDb } from '@prdm/db';",
      "const app = await import('@prdm/app');",
      "const db = require('@prdm/db');",
    ].join('\n');

    // Grouped by specifier (the order FORBIDDEN_SPECIFIERS is checked in), not by line order in `content`.
    expect(findForbiddenImports(content)).toEqual([
      "export { createTenantDb } from '@prdm/db'",
      "require('@prdm/db')",
      "import { buildServer } from '@prdm/server'",
      "import('@prdm/app')",
    ]);
  });
});
