import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fastGlob from 'fast-glob';
import { describe, expect, test } from 'vitest';

const CORE_SRC = resolve(import.meta.dirname, '../../src');
const FORBIDDEN_IMPORTS = [/from\s+['"]commander['"]/, /from\s+['"]chokidar['"]/, /from\s+['"]@modelcontextprotocol\//];

describe('architecture guard', () => {
  test('@prdm/core never imports the CLI or MCP frameworks', async () => {
    const files = await fastGlob('**/*.ts', { cwd: CORE_SRC, absolute: true });
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      const hits = FORBIDDEN_IMPORTS.filter((pattern) => pattern.test(content));
      return hits.length > 0 ? [{ file, hits: hits.map((p) => p.source) }] : [];
    });

    expect(offenders).toEqual([]);
  });
});
