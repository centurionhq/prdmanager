import { describe, expect, it } from 'vitest';
import type { DocumentBlock } from '../../../src/data';
import { findMatchingBlock, stripLinePrefix } from '../../../src/features/documento/proposalEdits';

function block(id: string, type: DocumentBlock['type'], text: string, extra?: Partial<DocumentBlock>): DocumentBlock {
  return { id, type, text, author: 'ana-rios', ...extra };
}

describe('findMatchingBlock: reuses the real serializer, so an ol proposal matches too', () => {
  it('matches an ordered-list line, numbered by its position among the other ol blocks', () => {
    const blocks: DocumentBlock[] = [block('b1', 'ol', 'Paso uno'), block('b2', 'ol', 'Paso dos'), block('b3', 'ol', 'Paso tres')];
    expect(findMatchingBlock(blocks, '2. Paso dos')?.id).toBe('b2');
    expect(findMatchingBlock(blocks, '3. Paso tres')?.id).toBe('b3');
  });

  it('still matches headings, bullets and tasks', () => {
    const blocks: DocumentBlock[] = [
      block('b1', 'h2', 'Riesgos'),
      block('b2', 'li', 'Un punto'),
      block('b3', 'task', 'Pendiente', { checked: false }),
    ];
    expect(findMatchingBlock(blocks, '## Riesgos')?.id).toBe('b1');
    expect(findMatchingBlock(blocks, '- Un punto')?.id).toBe('b2');
    expect(findMatchingBlock(blocks, '- [ ] Pendiente')?.id).toBe('b3');
  });

  it('returns undefined when nothing matches', () => {
    const blocks: DocumentBlock[] = [block('b1', 'p', 'Texto')];
    expect(findMatchingBlock(blocks, '- No existe')).toBeUndefined();
  });
});

describe('stripLinePrefix', () => {
  it('strips every block marker, including ordered-list numbering', () => {
    expect(stripLinePrefix('# Título')).toBe('Título');
    expect(stripLinePrefix('- Un punto')).toBe('Un punto');
    expect(stripLinePrefix('- [ ] Pendiente')).toBe('Pendiente');
    expect(stripLinePrefix('- [x] Hecho')).toBe('Hecho');
    expect(stripLinePrefix('3. Paso tres')).toBe('Paso tres');
  });

  it('leaves a plain paragraph line untouched', () => {
    expect(stripLinePrefix('Texto normal')).toBe('Texto normal');
  });
});
