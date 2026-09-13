import { describe, expect, test } from 'vitest';
import { parseDocument } from '../../src/parser/frontmatter.js';
import { nextId, renderDocument, slugify, todayIso } from '../../src/util/ids.js';

describe('ids and document rendering', () => {
  test('nextId continues the highest number of the same kind', () => {
    expect(nextId('WO', [])).toBe('WO-001');
    expect(nextId('WO', ['WO-001', 'WO-010', 'FB-099', 'WO-002'])).toBe('WO-011');
    expect(nextId('FR', ['FR-1234'])).toBe('FR-1235');
  });

  test('slugify produces ascii kebab-case bounded slugs', () => {
    expect(slugify('Triaje de Feedback: ¡Índice Full-Text!')).toBe('triaje-de-feedback-indice-full-text');
    expect(slugify('a'.repeat(80))).toHaveLength(50);
    expect(slugify('***')).toBe('doc');
  });

  test('todayIso formats a date as YYYY-MM-DD', () => {
    expect(todayIso(new Date('2026-09-12T23:00:00Z'))).toBe('2026-09-12');
  });

  test('renderDocument emits parseable frontmatter, skipping null/undefined fields', () => {
    const content = renderDocument(
      { id: 'FB-001', type: 'FB', title: 'Quote "x": y', source: 'email', informs: ['PRD-001'], customer: undefined, status: null },
      '## Feedback\ntexto',
    );
    expect(content).not.toContain('customer');
    const parsed = parseDocument(content, 'docs/feedback/FB-001.md');
    if (!parsed?.ok) throw new Error('expected valid document');
    expect(parsed.doc.node.title).toBe('Quote "x": y');
    expect(parsed.doc.edges).toEqual([{ from: 'FB-001', to: 'PRD-001', type: 'INFORMS' }]);
    expect(content.endsWith('texto\n')).toBe(true);
  });
});
