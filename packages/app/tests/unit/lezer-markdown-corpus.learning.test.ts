/**
 * Learning test — ADR-009 / WO-322.
 *
 * ADR-009's lossless editable preview needs to map `@lezer/markdown`'s parse tree back onto the raw
 * source text (a `Y.Text`) without ever dropping a character. This spec parses the corpus of files most
 * likely to expose a real edge case — every `docs/**\/*.md` in this repository, ~430 files with YAML
 * frontmatter, GFM task lists, tables, strikethrough, and every heading style this repo's own authors
 * actually use — and checks the *precise* shape of top-level node coverage, because ADR-009's own naive
 * assumption ("every top-level node's `to` equals the next one's `from`") turned out to be wrong.
 *
 * FOUND: top-level nodes are never truly contiguous. `@lezer/markdown` (like every CommonMark parser)
 * excludes the blank-line separators between block-level constructs from every node's own range — e.g. a
 * heading ending at `to=292` is followed by a paragraph starting at `from=294`, with the intervening
 * `"\n\n"` belonging to neither node. The YAML frontmatter this repo's own docs all start with makes this
 * extra visible at the very top of the tree: `@lezer/markdown` has no frontmatter concept, so it parses
 * the opening `---` as a `HorizontalRule` (a lone thematic break) and the rest of the frontmatter block as
 * a `SetextHeading2` (the closing `---` read as a setext underline) — CommonMark-legal, just not what a
 * human means by "frontmatter". None of this loses any *text*: the gap between consecutive nodes, and
 * before the first/after the last, is always exactly the whitespace CommonMark treats as insignificant
 * between blocks. So the actual, useful invariant a lossless preview can build on is: top-level ranges
 * are strictly ascending and non-overlapping, and every gap between them (including the prefix before the
 * first node and the suffix after the last) is whitespace-only — which is exactly what a lossless
 * round-trip needs, since re-inserting the *original* gap text between edited nodes reconstructs the
 * document exactly.
 *
 * All ~430 files in this corpus already satisfy that relaxed invariant (verified below over the corpus
 * found at collection time, no `.skip` needed) — CommonMark's own grammar guarantees a top-level block's
 * only non-block content is blank-line whitespace, and `@lezer/markdown` upholds that even for our
 * frontmatter/GFM-heavy corpus.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parser, Strikethrough, TaskList } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';

const DOCS_ROOT = resolve(import.meta.dirname, '../../../../docs');
const markdownParser = parser.configure([TaskList, Strikethrough]);

function collectMarkdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? collectMarkdownFiles(path) : name.endsWith('.md') ? [path] : [];
  });
}

interface TopLevelCoverageResult {
  ok: boolean;
  reason?: string;
}

/** Walks the tree's top-level (direct `Document` children) nodes left to right, verifying ascending,
 * non-overlapping ranges whose slices reproduce the source exactly, and that every gap between them
 * (leading, trailing, and between siblings) holds only CommonMark's own insignificant blank-line
 * whitespace. */
function checkTopLevelCoverage(body: string): TopLevelCoverageResult {
  const tree = markdownParser.parse(body);
  let node = tree.topNode.firstChild;
  let coveredTo = 0;

  while (node) {
    if (node.from < coveredTo) return { ok: false, reason: `node at ${node.from}-${node.to} overlaps previous coverage ending at ${coveredTo}` };

    const gap = body.slice(coveredTo, node.from);
    if (!/^\s*$/.test(gap)) return { ok: false, reason: `non-whitespace gap before ${node.from}: ${JSON.stringify(gap.slice(0, 40))}` };

    if (node.to < node.from) return { ok: false, reason: `node has a negative-length range: ${node.from}-${node.to}` };

    coveredTo = node.to;
    node = node.nextSibling;
  }

  const trailing = body.slice(coveredTo);
  if (!/^\s*$/.test(trailing)) return { ok: false, reason: `non-whitespace tail after ${coveredTo}: ${JSON.stringify(trailing.slice(0, 40))}` };

  return { ok: true };
}

describe('@lezer/markdown top-level node coverage over the docs/**/*.md corpus', () => {
  const files = collectMarkdownFiles(DOCS_ROOT);

  it('finds the corpus', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('produces ascending, non-overlapping top-level ranges whose gaps are whitespace-only, for every file', () => {
    const failures = files
      .map((file) => ({ file: relative(DOCS_ROOT, file), result: checkTopLevelCoverage(readFileSync(file, 'utf8')) }))
      .filter(({ result }) => !result.ok)
      .map(({ file, result }) => `${file}: ${result.reason}`);

    expect(failures).toEqual([]);
  });

  // The `TaskList` export is a `MarkdownConfig`, not a node name: it adds the `Task`/`TaskMarker`
  // node types actually emitted in the tree (verified here rather than assumed from the export's name).
  it('recognizes GFM task list items via the TaskList extension', () => {
    const tree = markdownParser.parse('- [ ] pending\n- [x] done\n');
    const names: string[] = [];
    tree.iterate({ enter: (node) => void names.push(node.name) });
    expect(names).toContain('Task');
    expect(names).toContain('TaskMarker');
  });

  it('recognizes GFM strikethrough via the Strikethrough extension', () => {
    const tree = markdownParser.parse('~~gone~~\n');
    const names: string[] = [];
    tree.iterate({ enter: (node) => void names.push(node.name) });
    expect(names).toContain('Strikethrough');
  });
});
