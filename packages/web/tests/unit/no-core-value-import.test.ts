import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_SRC = join(import.meta.dirname, '..', '..', 'src', 'client');

/**
 * Matches a whole `import .. from '@prdm/core'` / `export .. from '@prdm/core'` statement, single- or multi-line.
 * The specifier group excludes `;` so the lazy match can't run past this statement's own terminator into a
 * *later* unrelated `from '@prdm/core'` several statements down the file (every statement here ends in `;`) —
 * verified against a real false positive: an earlier `import { x } from 'react'` on its own line made the naive
 * `[\s\S]*?` swallow that whole statement too once a later line imported from `@prdm/core`.
 */
const CORE_IMPORT_PATTERN = /\b(import|export)\s+([^;]*?)\bfrom\s+(['"])@prdm\/core\3/g;
/** `verbatimModuleSyntax` and the static-import regex above only constrain `import`/`export ... from` declarations
 * — a `await import('@prdm/core')` dynamic-import *expression* is neither, and would sail past both undetected
 * (F6 architecture review). */
const DYNAMIC_CORE_IMPORT_PATTERN = /\bimport\s*\(\s*(['"])@prdm\/core\1\s*\)/g;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

/** Every `from '@prdm/core'` import/export statement, or `import('@prdm/core')` expression, in `content` that isn't type-only. */
function findCoreValueImports(content: string): string[] {
  const offenders: string[] = [];
  for (const match of content.matchAll(CORE_IMPORT_PATTERN)) {
    const specifier = match[2] ?? '';
    if (!/^\s*type\s/.test(specifier)) offenders.push(match[0].replace(/\s+/g, ' ').trim());
  }
  for (const match of content.matchAll(DYNAMIC_CORE_IMPORT_PATTERN)) offenders.push(match[0]);
  return offenders;
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

    const offenders = files.flatMap((file) => findCoreValueImports(readFileSync(file, 'utf8')).map((offense) => `${file}: ${offense}`));

    expect(offenders).toEqual([]);
  });

  it('does not flag a type-only core import preceded by an unrelated import on its own line (regression: a naive lazy match once spanned both statements)', () => {
    const content = "import { useState } from 'react';\nimport type { NodeDetail } from '@prdm/core';\n";
    expect(findCoreValueImports(content)).toEqual([]);
  });

  it('still flags a genuine value import from @prdm/core', () => {
    const content = "import { useState } from 'react';\nimport { scanDocuments } from '@prdm/core';\n";
    expect(findCoreValueImports(content)).toEqual(["import { scanDocuments } from '@prdm/core'"]);
  });

  it('flags a dynamic import() expression too, not just static import/export declarations', () => {
    const content = "async function load() {\n  const core = await import('@prdm/core');\n  return core;\n}\n";
    expect(findCoreValueImports(content)).toEqual(["import('@prdm/core')"]);
  });
});
