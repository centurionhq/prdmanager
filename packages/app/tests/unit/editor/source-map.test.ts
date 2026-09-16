import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyDocument, type SourceBlock } from '../../../src/editor/source-map.js';

const DOCS_ROOT = resolve(import.meta.dirname, '../../fixtures/markdown-corpus');

function collectMarkdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? collectMarkdownFiles(path) : name.endsWith('.md') ? [path] : [];
  });
}

function slice(source: string, block: SourceBlock): string {
  return source.slice(block.from, block.to);
}

describe('classifyDocument', () => {
  it('classifies a simple paragraph with a single text run', () => {
    const source = 'Hello world';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('paragraph');
    expect(slice(source, block!)).toBe('Hello world');
    expect(block?.contentFrom).toBe(0);
    expect(block?.runs).toEqual([{ kind: 'text', from: 0, to: 11 }]);
  });

  it('classifies an ATX heading 1', () => {
    const source = '# Title';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('heading1');
    expect(slice(source, block!)).toBe('# Title');
    expect(block?.contentFrom).toBe(2);
    expect(block?.runs).toEqual([{ kind: 'text', from: 2, to: 7 }]);
  });

  it('classifies an ATX heading 2', () => {
    const source = '## Title';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('heading2');
    expect(slice(source, block!)).toBe('## Title');
    expect(block?.contentFrom).toBe(3);
  });

  it('classifies an ATX heading 3', () => {
    const source = '### Title';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('heading3');
    expect(slice(source, block!)).toBe('### Title');
    expect(block?.contentFrom).toBe(4);
  });

  it('classifies a tight bullet list as individual bullet-item blocks', () => {
    const source = '- one\n- two';
    const blocks = classifyDocument(source);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('bullet-item');
    expect(slice(source, blocks[0]!)).toBe('- one');
    expect(blocks[0]?.contentFrom).toBe(2);
    expect(blocks[1]?.kind).toBe('bullet-item');
    expect(slice(source, blocks[1]!)).toBe('- two');
  });

  it('classifies a tight ordered list as individual ordered-item blocks, keeping the literal marker number', () => {
    const source = '5. fifth\n6. sixth';
    const blocks = classifyDocument(source);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('ordered-item');
    expect(blocks[0]?.orderedNumber).toBe(5);
    expect(slice(source, blocks[0]!)).toBe('5. fifth');
    expect(blocks[1]?.orderedNumber).toBe(6);
  });

  it('classifies a task-item as unchecked', () => {
    const source = '- [ ] pending';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('task-item');
    expect(block?.taskChecked).toBe(false);
    expect(slice(source, block!)).toBe('- [ ] pending');
    expect(block?.contentFrom).toBe(6);
  });

  it('classifies a task-item as checked', () => {
    const source = '- [x] done';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('task-item');
    expect(block?.taskChecked).toBe(true);
  });

  it('classifies inline runs: emphasis, strong, strikethrough, link, escape and softbreak', () => {
    const source = 'a *em* b **strong** c ~~gone~~ d [link](https://x.com) e \\* f\ng';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('paragraph');
    const kinds = block?.runs?.map((run) => run.kind);
    expect(kinds).toEqual([
      'text',
      'emphasis',
      'text',
      'strong',
      'text',
      'strikethrough',
      'text',
      'link',
      'text',
      'escape',
      'text',
      'softbreak',
      'text',
    ]);
    const linkRun = block?.runs?.find((run) => run.kind === 'link');
    expect(linkRun?.href).toBe('https://x.com');
  });

  it('classifies a table as an island', () => {
    const source = '| a | b |\n|---|---|\n| 1 | 2 |';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('island');
    expect(slice(source, block!)).toBe(source);
    expect(block?.runs).toBeUndefined();
  });

  it('classifies a code fence with a line starting with "#" as an island', () => {
    const source = '```\n# not a heading\n```';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('island');
    expect(slice(source, block!)).toBe(source);
  });

  it('classifies a blockquote as an island', () => {
    const source = '> quoted text';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('island');
  });

  it('classifies a list with a nested sub-item as a single island covering the whole list', () => {
    const source = '- outer\n  - inner';
    const blocks = classifyDocument(source);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('island');
    expect(slice(source, blocks[0]!)).toBe(source);
  });

  it('classifies an h4 heading as an island', () => {
    const source = '#### Title';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('island');
  });

  it('classifies a Setext heading as an island', () => {
    const source = 'Title\n=====';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('island');
  });

  it('classifies a loose list (blank line between items) as a single island', () => {
    const source = '- one\n\n- two';
    const blocks = classifyDocument(source);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('island');
    expect(slice(source, blocks[0]!)).toBe(source);
  });

  it('classifies a list item containing inline code as an island for that item only', () => {
    const source = '- has `code` inline\n- plain';
    const blocks = classifyDocument(source);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('island');
    expect(slice(source, blocks[0]!)).toBe('- has `code` inline');
    expect(blocks[1]?.kind).toBe('bullet-item');
  });

  it('classifies a bullet item using "*" or "+" markers', () => {
    const source = '* star item';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('bullet-item');
    expect(slice(source, block!)).toBe('* star item');
  });

  it('rejects an uppercase task checkbox marker, treating the whole list as an island', () => {
    const source = '- [X] shouting';
    const [block] = classifyDocument(source);

    expect(block?.kind).toBe('island');
  });

  const plainTextArbitrary = fc
    .stringMatching(/^[A-Za-z0-9 ]+$/)
    .filter((text) => text.trim().length > 0 && !/^\s|\s$/.test(text));

  it('property: plain text paragraphs without markdown-special characters always classify as a single text run', () => {
    fc.assert(
      fc.property(plainTextArbitrary, (text) => {
        const blocks = classifyDocument(text);

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.kind).toBe('paragraph');
        expect(blocks[0]?.runs).toEqual([{ kind: 'text', from: 0, to: text.length }]);
      }),
    );
  });

  it('corpus: every block classified from every file in the frozen governance-docs corpus has valid, non-inverted, in-range offsets', () => {
    const files = collectMarkdownFiles(DOCS_ROOT);
    expect(files.length).toBeGreaterThan(300);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const blocks = classifyDocument(source);

      for (const block of blocks) {
        expect(block.from).toBeGreaterThanOrEqual(0);
        expect(block.to).toBeLessThanOrEqual(source.length);
        expect(block.from).toBeLessThanOrEqual(block.to);
        expect(block.contentFrom).toBeGreaterThanOrEqual(block.from);
        expect(block.contentFrom).toBeLessThanOrEqual(block.to);
      }
    }
  });
});
