import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES_ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * WO-129/SDD-007: the root `@prdm/mcp` export (`server.ts`) runs `main()` as a side effect of being imported
 * (connects to Neo4j, starts a stdio server); nothing outside `packages/mcp` itself may import it. Anything
 * that needs `createPrdmServer`/`registerPrdmTools`/etc. must go through `@prdm/mcp/lib` instead.
 */
const MCP_ROOT_IMPORT_PATTERN = /\b(import|export)\s+([^;]*?)\bfrom\s+(['"])@prdm\/mcp\3/g;
const DYNAMIC_MCP_ROOT_IMPORT_PATTERN = /\bimport\s*\(\s*(['"])@prdm\/mcp\1\s*\)/g;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist') return [];
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

function otherPackageDirs(): string[] {
  return readdirSync(PACKAGES_ROOT)
    .filter((name) => name !== 'mcp')
    .map((name) => join(PACKAGES_ROOT, name))
    .filter((dir) => statSync(dir).isDirectory());
}

function findMcpRootImports(content: string): string[] {
  const offenders: string[] = [];
  for (const match of content.matchAll(MCP_ROOT_IMPORT_PATTERN)) offenders.push(match[0].replace(/\s+/g, ' ').trim());
  for (const match of content.matchAll(DYNAMIC_MCP_ROOT_IMPORT_PATTERN)) offenders.push(match[0]);
  return offenders;
}

describe('nothing outside packages/mcp imports the bare @prdm/mcp export', () => {
  it('no other package source file imports "@prdm/mcp" (only "@prdm/mcp/lib" is allowed)', () => {
    const files = otherPackageDirs().flatMap((dir) => collectSourceFiles(dir));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) => findMcpRootImports(readFileSync(file, 'utf8')).map((offense) => `${file}: ${offense}`));

    expect(offenders).toEqual([]);
  });

  it('still flags a genuine bare @prdm/mcp import, but not a @prdm/mcp/lib one', () => {
    const bad = "import { createPrdmServer } from '@prdm/mcp';\n";
    const good = "import { createPrdmServer } from '@prdm/mcp/lib';\n";
    expect(findMcpRootImports(bad)).toEqual(["import { createPrdmServer } from '@prdm/mcp'"]);
    expect(findMcpRootImports(good)).toEqual([]);
  });
});
