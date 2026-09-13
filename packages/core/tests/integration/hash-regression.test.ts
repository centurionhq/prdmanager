import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fg from 'fast-glob';
import { describe, expect, test } from 'vitest';
import { contentHash, parseDocument } from '../../src/parser/frontmatter.js';
import { loadBaseline } from '../../src/sync/baseline.js';

/** This test file lives at packages/core/tests/integration/; the worktree root is four levels up. */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

/**
 * Regression proof for ADR-002 D9 hash compatibility: every real document in this worktree still hashes to its
 * `.prdm/baseline.json` value, even though `impacts_paths`/`pending` are now canonical and blueprints exclude
 * their `## Tareas` section by default. Non-blueprints compare against the normal (operative) hash; blueprints
 * compare against the legacy (tasks-included) hash, because the committed baseline predates `prdm migrate docs`
 * re-baselining the tasks exclusion.
 *
 * Work orders generated from SDD-002 (this very PRD-002 effort) are excluded from the strict comparison: they are
 * being actively claimed/edited by parallel agents in this multi-agent session, so their baseline entry can be
 * legitimately stale for reasons that have nothing to do with this work order. They are still parsed and hashed
 * (to catch outright crashes), just not compared byte-for-byte.
 */
describe('content hash regression against the committed baseline', () => {
  test('every real document hashes to its recorded baseline value', async () => {
    const baseline = await loadBaseline(REPO_ROOT);
    expect(Object.keys(baseline.docs).length).toBeGreaterThan(0);

    const files = await fg.glob(['docs/**/*.md', '*.md'], { cwd: REPO_ROOT, onlyFiles: true, dot: false });
    const mismatches: string[] = [];
    let checked = 0;
    let skippedInFlight = 0;

    for (const rel of files) {
      const content = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
      const result = parseDocument(content, rel);
      if (!result || !result.ok) continue; // not a graph document (no frontmatter), or invalid for unrelated reasons
      const { doc } = result;
      const expected = baseline.docs[doc.node.id];
      if (expected === undefined) continue; // not yet baselined by a `prdm sync`

      const inFlightBlueprints = ['SDD-002', 'ADR-002'];
      if (doc.frontmatter.type === 'WO' && doc.frontmatter.implements.some((id) => inFlightBlueprints.includes(id))) {
        skippedInFlight++;
        continue;
      }

      const isBlueprint = doc.frontmatter.type === 'SDD' || doc.frontmatter.type === 'ADR';
      const actual = isBlueprint ? contentHash(doc.frontmatter, doc.node.body, { includeTasks: true }) : doc.node.contentHash;
      checked++;
      if (actual !== expected) mismatches.push(`${doc.node.id} (${rel}): expected ${expected}, got ${actual}`);
    }

    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(10);
    expect(skippedInFlight).toBeGreaterThan(0);
  });
});
