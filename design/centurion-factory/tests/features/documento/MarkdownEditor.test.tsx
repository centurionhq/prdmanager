import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DocumentBlock } from '../../../src/data';
import { MarkdownEditor } from '../../../src/features/documento/MarkdownEditor';

function block(id: string, author: string): DocumentBlock {
  return { id, type: 'p', text: 'x', author };
}

describe('MarkdownEditor gutter: authorship follows the line -> block map, not the raw line index', () => {
  it('attributes each line to its own block even when a blank separator shifts later lines down', () => {
    const gutterBlocks = [block('b1', 'julia-paz'), block('b2', 'ana-rios')];
    // serializeBlocks emits a blank separator between a heading and the paragraph that follows it,
    // so line 0 = b1, line 1 = blank (no block), line 2 = b2 — not `gutterBlocks[lineIndex]`.
    const value = '# Título\n\nUn párrafo.';
    const lineBlockIds = ['b1', undefined, 'b2'];

    const { container } = render(<MarkdownEditor value={value} onChange={() => {}} gutterBlocks={gutterBlocks} lineBlockIds={lineBlockIds} />);

    const authors = Array.from(container.querySelectorAll('[class*="gutterAuthor"]')).map((element) => element.textContent);
    expect(authors).toEqual(['JP', '', 'AR']);
  });

  it('shows the agent marker for an agent-authored line', () => {
    const gutterBlocks = [block('b1', 'agent')];
    const { container } = render(<MarkdownEditor value="Texto" onChange={() => {}} gutterBlocks={gutterBlocks} lineBlockIds={['b1']} />);

    const authors = Array.from(container.querySelectorAll('[class*="gutterAuthor"]')).map((element) => element.textContent);
    expect(authors).toEqual(['Agente']);
  });
});
