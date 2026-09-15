import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI_SRC = join(import.meta.dirname, '..', '..', 'src');

/**
 * Same guard as `packages/web/tests/unit/no-core-value-import.test.ts` (SDD-006: `packages/ui` may only ever
 * `import type` from `@prdm/core`, never a value) — replicated here rather than shared, since the two packages'
 * `src` trees are independent and this file is small enough that a shared helper would add more indirection than
 * it saves.
 */
const CORE_IMPORT_PATTERN = /\b(import|export)\s+([^;]*?)\bfrom\s+(['"])@prdm\/core\3/g;
const DYNAMIC_CORE_IMPORT_PATTERN = /\bimport\s*\(\s*(['"])@prdm\/core\1\s*\)/g;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

function findCoreValueImports(content: string): string[] {
  const offenders: string[] = [];
  for (const match of content.matchAll(CORE_IMPORT_PATTERN)) {
    const specifier = match[2] ?? '';
    if (!/^\s*type\s/.test(specifier)) offenders.push(match[0].replace(/\s+/g, ' ').trim());
  }
  for (const match of content.matchAll(DYNAMIC_CORE_IMPORT_PATTERN)) offenders.push(match[0]);
  return offenders;
}

describe('ui never imports a value from @prdm/core', () => {
  it('every "@prdm/core" import/export specifier in src is type-only', () => {
    const files = collectSourceFiles(UI_SRC);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) => findCoreValueImports(readFileSync(file, 'utf8')).map((offense) => `${file}: ${offense}`));

    expect(offenders).toEqual([]);
  });

  it('still flags a genuine value import from @prdm/core', () => {
    const content = "import { useState } from 'react';\nimport { scanDocuments } from '@prdm/core';\n";
    expect(findCoreValueImports(content)).toEqual(["import { scanDocuments } from '@prdm/core'"]);
  });
});
