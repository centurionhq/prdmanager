import { describe, expect, test } from 'vitest';
import { DOC_KINDS } from '../../src/domain/schema.js';
import { TEMPLATES, isTemplateKind, templateFor, type TemplateKind } from '../../src/templates/index.js';

const AUTHORABLE_KINDS: TemplateKind[] = ['MRD', 'PRD', 'FR', 'SDD', 'ADR', 'FB', 'ART'];

describe('templateFor', () => {
  test.each(AUTHORABLE_KINDS)('returns a skeleton with frontmatter and id placeholder for %s', (kind) => {
    const src = templateFor(kind);
    expect(src.startsWith('---\n')).toBe(true);
    expect(src).toContain(`id: ${kind}-?`);
    expect(src).toContain(`type: ${kind}`);
  });

  test('SDD and ADR templates include impacts_paths and a Tareas checklist', () => {
    for (const kind of ['SDD', 'ADR'] as const) {
      const src = templateFor(kind);
      expect(src).toContain('impacts_paths: []');
      expect(src).toMatch(/## Tareas\n\n- \[ \]/);
    }
  });

  test('FB template uses informs and root', () => {
    const src = templateFor('FB');
    expect(src).toContain('informs: []');
    expect(src).toContain('root: true');
  });

  test('ART template uses provides_context_for and root', () => {
    const src = templateFor('ART');
    expect(src).toContain('provides_context_for: []');
    expect(src).toContain('root: true');
  });

  test('MRD, PRD and FR templates carry justified_by', () => {
    for (const kind of ['MRD', 'PRD', 'FR'] as const) {
      expect(templateFor(kind)).toContain('justified_by: []');
    }
  });

  test('WO is excluded from TEMPLATES and isTemplateKind', () => {
    expect(Object.keys(TEMPLATES)).not.toContain('WO');
    expect(isTemplateKind('WO')).toBe(false);
    for (const kind of DOC_KINDS) {
      if (kind !== 'WO') expect(isTemplateKind(kind)).toBe(true);
    }
  });
});
