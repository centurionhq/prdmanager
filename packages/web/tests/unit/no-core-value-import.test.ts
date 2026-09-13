import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_SRC = join(import.meta.dirname, '..', '..', 'src', 'client');

/** Matches a whole `import .. from '@prdm/core'` / `export .. from '@prdm/core'` statement, single- or multi-line. */
const CORE_IMPORT_PATTERN = /\b(import|export)\s+([\s\S]*?)\bfrom\s+(['"])@prdm\/core\3/g;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

/**
 * SDD-005 "Build: servidor y cliente no comparten dist": `verbatimModuleSyntax: true` already forces every
 * `@prdm/core` import to be `import type` at compile time, but that guard only fires when a value from the import
 * is actually used as a value; this test is the belt-and-suspenders check the SDD explicitly asks for — it fails
 * loudly on any `from '@prdm/core'` import line under `src/client/**` that isn't `import type`/`export type`, so a
 * future edit can't silently drag `neo4j-driver`/`node:fs` into the browser bundle.
 */
describe('web client never imports a value from @prdm/core', () => {
  it('every "@prdm/core" import/export specifier in src/client is type-only', () => {
    const files = collectSourceFiles(CLIENT_SRC);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(CORE_IMPORT_PATTERN)) {
        const specifier = match[2] ?? '';
        const isTypeOnly = /^\s*type\s/.test(specifier);
        if (!isTypeOnly) offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ').trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
