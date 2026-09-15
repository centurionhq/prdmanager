import { describe, expect, it } from 'vitest';
import type { DocumentBlock } from '../../../src/data';
import { reconcileBlocks } from '../../../src/features/documento/blockReconciliation';

function block(id: string, type: DocumentBlock['type'], text: string, extra?: Partial<DocumentBlock>): DocumentBlock {
  return { id, type, text, author: 'ana-rios', ...extra };
}

describe('reconcileBlocks', () => {
  it('keeps the id and author of blocks at an unchanged position', () => {
    const previous: DocumentBlock[] = [block('b1', 'h1', 'Viejo', { author: 'julia-paz' })];
    const [reconciled] = reconcileBlocks(previous, [{ type: 'h1', text: 'Nuevo' }], 'ana-rios');
    expect(reconciled).toEqual({ id: 'b1', type: 'h1', text: 'Nuevo', checked: undefined, author: 'julia-paz' });
  });

  it('attributes brand-new lines to the fallback author with a fresh id', () => {
    const [reconciled] = reconcileBlocks([], [{ type: 'p', text: 'Nueva línea' }], 'ana-rios');
    expect(reconciled?.author).toBe('ana-rios');
    expect(reconciled?.text).toBe('Nueva línea');
    expect(reconciled?.id).toBeTruthy();
  });

  it('matches unchanged blocks by exact text, so inserting a line at the top never shifts attribution', () => {
    const previous: DocumentBlock[] = [
      block('b1', 'h1', 'Título', { author: 'julia-paz' }),
      block('b2', 'p', 'Contenido original.', { author: 'martin-sosa' }),
    ];
    const reconciled = reconcileBlocks(
      previous,
      [
        { type: 'p', text: 'Una línea nueva insertada arriba.' },
        { type: 'h1', text: 'Título' },
        { type: 'p', text: 'Contenido original.' },
      ],
      'ana-rios',
    );

    expect(reconciled[0]?.author).toBe('ana-rios');
    expect(reconciled[0]?.id).not.toBe('b1');
    expect(reconciled[1]).toEqual({ id: 'b1', type: 'h1', text: 'Título', checked: undefined, author: 'julia-paz' });
    expect(reconciled[2]).toEqual({ id: 'b2', type: 'p', text: 'Contenido original.', checked: undefined, author: 'martin-sosa' });
  });

  it('matches a normalized (whitespace/case) near-duplicate and drops a stale acceptedBy', () => {
    const previous: DocumentBlock[] = [block('b1', 'task', 'Revisión visual manual en mobile', { author: 'agent', acceptedBy: 'ana-rios' })];
    const [reconciled] = reconcileBlocks(previous, [{ type: 'task', text: '  Revisión Visual Manual en mobile  ', checked: false }], 'ana-rios');

    expect(reconciled?.id).toBe('b1');
    expect(reconciled?.author).toBe('agent');
    expect(reconciled?.acceptedBy).toBeUndefined();
  });

  it('aligns an edited line by text similarity, keeping its id but dropping acceptedBy', () => {
    const previous: DocumentBlock[] = [block('b1', 'p', 'El motor lee el archivo de configuración inicial.', { acceptedBy: 'ana-rios' })];
    const [reconciled] = reconcileBlocks(previous, [{ type: 'p', text: 'El motor lee el archivo de configuración inicial y valida el esquema.' }], 'ana-rios');

    expect(reconciled?.id).toBe('b1');
    expect(reconciled?.acceptedBy).toBeUndefined();
  });

  it('keeps acceptedBy when the text is exactly unchanged', () => {
    const previous: DocumentBlock[] = [block('b1', 'p', 'Texto aceptado tal cual.', { author: 'agent', acceptedBy: 'ana-rios' })];
    const [reconciled] = reconcileBlocks(previous, [{ type: 'p', text: 'Texto aceptado tal cual.' }], 'ana-rios');

    expect(reconciled?.acceptedBy).toBe('ana-rios');
  });
});
