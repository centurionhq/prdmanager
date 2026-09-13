import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fg from 'fast-glob';
import { describe, expect, test } from 'vitest';
import { contentHash, parseDocument } from '../../src/parser/frontmatter.js';
import { loadBaseline } from '../../src/sync/baseline.js';

/** This test file lives at packages/core/tests/integration/; the worktree root is four levels up. */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const DRIFT_KINDS = new Set(['MRD', 'PRD', 'FR', 'SDD', 'ADR']);

/**
 * Regression proof for ADR-002 D9 hash compatibility: every real document in this worktree still hashes to its
 * `.prdm/baseline.json` value, even though `impacts_paths`/`pending` are now canonical and blueprints exclude
 * their `## Tareas` section by default. Blueprints may match either the operative hash (after `prdm migrate docs`)
 * or the legacy tasks-included hash (before it), so the test holds on both sides of the migration.
 */
describe('content hash regression against the committed baseline', () => {
  test('every real document hashes to its recorded baseline value', async () => {
    const baseline = await loadBaseline(REPO_ROOT);
    expect(Object.keys(baseline.docs).length).toBeGreaterThan(0);

    const files = await fg.glob(['docs/**/*.md', '*.md'], { cwd: REPO_ROOT, onlyFiles: true, dot: false });
    const mismatches: string[] = [];
    let checked = 0;

    for (const rel of files) {
      const content = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
      const result = parseDocument(content, rel);
      if (!result || !result.ok) continue; // not a graph document (no frontmatter), or invalid for unrelated reasons
      const { doc } = result;
      const expected = baseline.docs[doc.node.id];
      if (expected === undefined) continue; // not yet baselined by a `prdm sync`
      // Only features and blueprints drive drift; work order/feedback/artifact baseline entries are not re-recorded on edit.
      if (!DRIFT_KINDS.has(doc.frontmatter.type)) continue;

      const isBlueprint = doc.frontmatter.type === 'SDD' || doc.frontmatter.type === 'ADR';
      const accepted = isBlueprint
        ? [doc.node.contentHash, contentHash(doc.frontmatter, doc.node.body, { includeTasks: true })]
        : [doc.node.contentHash];
      checked++;
      if (!accepted.includes(expected)) mismatches.push(`${doc.node.id} (${rel}): expected ${expected}, got ${accepted.join(' | ')}`);
    }

    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(4);
  });
});
