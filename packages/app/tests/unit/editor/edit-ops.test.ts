import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  deleteRange,
  escapeMarkdownText,
  insertLink,
  insertText,
  isProtectedTareasHeading,
  joinBlocks,
  setBlockType,
  splitBlock,
  toggleMark,
  toggleTask,
  type Splice,
} from '../../../src/editor/edit-ops.js';
import { classifyDocument, type SourceBlock } from '../../../src/editor/source-map.js';

const DOCS_ROOT = resolve(import.meta.dirname, '../../fixtures/markdown-corpus');

function collectMarkdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? collectMarkdownFiles(path) : name.endsWith('.md') ? [path] : [];
  });
}

function applySplice(source: string, splice: Splice): string {
  return source.slice(0, splice.from) + splice.insert + source.slice(splice.to);
}

function firstBlock(source: string): SourceBlock {
  const block = classifyDocument(source)[0];
  if (!block) throw new Error('expected at least one block');
  return block;
}

describe('escapeMarkdownText', () => {
  it('escapes backslash, emphasis, strikethrough, brackets and backtick anywhere in the text', () => {
    expect(escapeMarkdownText('a\\b*c_d~e[f]g`h')).toBe('a\\\\b\\*c\\_d\\~e\\[f\\]g\\`h');
  });

  it('escapes a leading "#" so it cannot become a heading marker', () => {
    expect(escapeMarkdownText('# not a heading')).toBe('\\# not a heading');
  });

  it('escapes a leading "-" so it cannot become a bullet marker', () => {
    expect(escapeMarkdownText('- not a bullet')).toBe('\\- not a bullet');
  });

  it('escapes a leading "+" so it cannot become a bullet marker', () => {
    expect(escapeMarkdownText('+ not a bullet')).toBe('\\+ not a bullet');
  });

  it('does not escape "#", "-" or "+" in the middle of the text', () => {
    expect(escapeMarkdownText('a # b - c + d')).toBe('a # b - c + d');
  });

  it('does not escape plain spaces or ordinary punctuation', () => {
    expect(escapeMarkdownText('hello, world! 100%')).toBe('hello, world! 100%');
  });
});

describe('insertText', () => {
  it('inserts escaped text at the given offset relative to contentFrom', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    const splice = insertText(block, 5, ' *there*', source);

    expect(splice).toEqual({ from: 5, to: 5, insert: ' \\*there\\*' });
    expect(applySplice(source, splice)).toBe('Hello \\*there\\* world');
  });
});

describe('deleteRange', () => {
  it('returns a splice that deletes the given range relative to contentFrom', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    const splice = deleteRange(block, 0, 6, source);

    expect(splice).toEqual({ from: 0, to: 6, insert: '' });
    expect(applySplice(source, splice)).toBe('world');
  });
});

describe('splitBlock', () => {
  it('splits a paragraph into two blank-line-separated paragraphs', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    const splice = splitBlock(block, 5, source);

    expect(applySplice(source, splice)).toBe('Hello\n\n world');
  });

  it('splits a heading with a blank-line separator too', () => {
    const source = '# Hello world';
    const block = firstBlock(source);
    const splice = splitBlock(block, 5, source);

    expect(applySplice(source, splice)).toBe('# Hello\n\n world');
  });

  it('splits a bullet item reusing its own marker', () => {
    const source = '* onetwo';
    const block = firstBlock(source);
    const splice = splitBlock(block, 3, source);

    expect(applySplice(source, splice)).toBe('* one\n* two');
  });

  it('splits an ordered item without renumbering, using N+1', () => {
    const source = '5. onetwo';
    const block = firstBlock(source);
    const splice = splitBlock(block, 3, source);

    expect(applySplice(source, splice)).toBe('5. one\n6. two');
  });

  it('splits a task item inserting a fresh unchecked task marker', () => {
    const source = '- [ ] onetwo';
    const block = firstBlock(source);
    const splice = splitBlock(block, 3, source);

    expect(applySplice(source, splice)).toBe('- [ ] one\n- [ ] two');
  });
});

describe('joinBlocks', () => {
  it('joins two paragraphs separated only by blank lines with a single space', () => {
    const source = 'first\n\nsecond';
    const [first, second] = classifyDocument(source);
    const splice = joinBlocks(first!, second!, '\n\n');

    expect(splice).not.toBeNull();
    expect(applySplice(source, splice!)).toBe('first second');
  });

  it('returns null when the separator between blocks is not blank-lines-only', () => {
    const source = 'first\n\n> quoted\n\nsecond';
    const blocks = classifyDocument(source);
    const first = blocks[0]!;
    const second = blocks[blocks.length - 1]!;
    const between = source.slice(first.to, second.from);
    const splice = joinBlocks(first, second, between);

    expect(splice).toBeNull();
  });
});

describe('toggleMark', () => {
  it('adds strong delimiters when none of the selection is marked', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    const splice = toggleMark(block, 0, 5, 'strong', source);

    expect(splice).not.toBeNull();
    expect(applySplice(source, splice!)).toBe('**Hello** world');
  });

  it('removes strong delimiters when the whole selection is already marked', () => {
    const source = '**Hello** world';
    const block = firstBlock(source);
    const strongRun = block.runs?.find((run) => run.kind === 'strong');
    expect(strongRun).toBeDefined();
    const splice = toggleMark(
      block,
      strongRun!.from - block.contentFrom,
      strongRun!.to - block.contentFrom,
      'strong',
      source,
    );

    expect(splice).not.toBeNull();
    expect(applySplice(source, splice!)).toBe('Hello world');
  });

  it('trims surrounding whitespace from the selection before operating', () => {
    const source = 'Hello world and more';
    const block = firstBlock(source);
    const splice = toggleMark(block, 5, 12, 'emphasis', source);

    expect(applySplice(source, splice!)).toBe('Hello *world* and more');
  });

  it('returns null when the selection partially overlaps an existing mark', () => {
    const source = '*Hello* world';
    const block = firstBlock(source);
    const splice = toggleMark(block, 2, 9, 'emphasis', source);

    expect(splice).toBeNull();
  });

  it('applying toggleMark twice on the same selection restores the original text', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z]{1,10}$/),
        fc.constantFrom('strong', 'emphasis', 'strikethrough'),
        (word, mark) => {
          const source = `before ${word} after`;
          const block = firstBlock(source);
          const from = 'before '.length;
          const to = from + word.length;

          const first = toggleMark(block, from, to, mark, source);
          expect(first).not.toBeNull();
          const afterFirst = applySplice(source, first!);

          const reparsedBlock = firstBlock(afterFirst);
          const shift = first!.insert.length - (first!.to - first!.from);
          const second = toggleMark(reparsedBlock, from, to + shift, mark, afterFirst);
          expect(second).not.toBeNull();
          const afterSecond = applySplice(afterFirst, second!);

          expect(afterSecond).toBe(source);
        },
      ),
    );
  });
});

describe('setBlockType', () => {
  it('rewrites only the block prefix, from paragraph to heading', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    const splice = setBlockType(block, 'heading2', source);

    expect(applySplice(source, splice)).toBe('## Hello world');
  });

  it('rewrites only the block prefix, from heading to paragraph', () => {
    const source = '### Hello world';
    const block = firstBlock(source);
    const splice = setBlockType(block, 'paragraph', source);

    expect(applySplice(source, splice)).toBe('Hello world');
  });
});

describe('toggleTask', () => {
  it('flips an unchecked task to checked', () => {
    const source = '- [ ] pending';
    const block = firstBlock(source);
    const splice = toggleTask(block);

    expect(applySplice(source, splice)).toBe('- [x] pending');
  });

  it('flips a checked task to unchecked', () => {
    const source = '- [x] done';
    const block = firstBlock(source);
    const splice = toggleTask(block);

    expect(applySplice(source, splice)).toBe('- [ ] done');
  });

  it('throws when called on a non task-item block', () => {
    const source = 'Hello world';
    const block = firstBlock(source);

    expect(() => toggleTask(block)).toThrow();
  });
});

describe('insertLink', () => {
  it('wraps the selection in a markdown link with the given href', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    const splice = insertLink(block, 0, 5, 'https://example.com', source);

    expect(applySplice(source, splice)).toBe('[Hello](https://example.com) world');
  });

  it('allows http, https, mailto and root-relative hrefs unchanged', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    expect(applySplice(source, insertLink(block, 0, 5, 'http://x.com', source))).toContain('(http://x.com)');
    expect(applySplice(source, insertLink(block, 0, 5, 'mailto:a@b.com', source))).toContain('(mailto:a@b.com)');
    expect(applySplice(source, insertLink(block, 0, 5, '/relative/path', source))).toContain('(/relative/path)');
  });

  it('sanitizes a javascript: href down to "#"', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    const splice = insertLink(block, 0, 5, 'javascript:alert(1)', source);

    expect(applySplice(source, splice)).toBe('[Hello](#) world');
  });

  it('sanitizes any other unrecognized scheme down to "#"', () => {
    const source = 'Hello world';
    const block = firstBlock(source);
    const splice = insertLink(block, 0, 5, 'ftp://x.com', source);

    expect(applySplice(source, splice)).toBe('[Hello](#) world');
  });
});

describe('the "## Tareas" heading is never editable from the preview', () => {
  const source = '## Tareas';
  const block = firstBlock(source);

  it('insertText throws', () => {
    expect(() => insertText(block, 0, 'x', source)).toThrow(/## Tareas/);
  });

  it('deleteRange throws', () => {
    expect(() => deleteRange(block, 0, 1, source)).toThrow(/## Tareas/);
  });

  it('setBlockType throws', () => {
    expect(() => setBlockType(block, 'paragraph', source)).toThrow(/## Tareas/);
  });

  it('splitBlock throws', () => {
    expect(() => splitBlock(block, 3, source)).toThrow(/## Tareas/);
  });

  it('isProtectedTareasHeading reports true for the exact "## Tareas" heading2 block', () => {
    expect(isProtectedTareasHeading(block, source)).toBe(true);
  });

  it('isProtectedTareasHeading reports false for any other heading2 or block kind', () => {
    const otherHeading = '## Other';
    expect(isProtectedTareasHeading(firstBlock(otherHeading), otherHeading)).toBe(false);
    const paragraph = 'Tareas';
    expect(isProtectedTareasHeading(firstBlock(paragraph), paragraph)).toBe(false);
  });
});

describe('property: editing an untouched block leaves it byte-identical after re-classification', () => {
  const files = collectMarkdownFiles(DOCS_ROOT);

  it('finds the corpus', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('holds for every editable block found across the corpus', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const blocks = classifyDocument(source);
      const editableIndex = blocks.findIndex(
        (block) => block.kind !== 'island' && block.runs?.some((run) => run.kind === 'text'),
      );
      if (editableIndex === -1) continue;

      const target = blocks[editableIndex]!;
      if (source.slice(target.from, target.to).includes('Tareas')) continue;

      const splice = insertText(target, 0, 'X', source);
      const edited = applySplice(source, splice);
      const editedBlocks = classifyDocument(edited);

      const shift = splice.insert.length - (splice.to - splice.from);
      for (let i = 0; i < blocks.length; i++) {
        if (i === editableIndex) continue;
        const before = blocks[i]!;
        const after = editedBlocks[i]!;
        const beforeFrom = before.from >= target.to ? before.from + shift : before.from;
        const beforeTo = before.to >= target.to ? before.to + shift : before.to;

        expect(after.kind).toBe(before.kind);
        expect(after.from).toBe(beforeFrom);
        expect(after.to).toBe(beforeTo);
        expect(edited.slice(after.from, after.to)).toBe(source.slice(before.from, before.to));
      }
    }
  });
});
