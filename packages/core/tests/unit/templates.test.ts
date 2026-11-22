import { describe, expect, test } from 'vitest';
import { DOC_KINDS } from '../../src/domain/schema.js';
import { REQUIRED_SECTIONS, missingSections } from '../../src/domain/required-sections.js';
import { TEMPLATES, isTemplateKind, templateFor, type TemplateKind } from '../../src/templates/index.js';

const AUTHORABLE_KINDS: TemplateKind[] = ['MRD', 'PRD', 'FR', 'BC', 'SDD', 'ADR', 'FB', 'ART'];

/** Template body without the YAML frontmatter (between the first two `---` lines). */
function templateBody(kind: TemplateKind): string {
  const lines = templateFor(kind).split('\n');
  const end = lines.indexOf('---', 1);
  return lines.slice(end + 1).join('\n');
}

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

  test('MRD, PRD, FR and BC templates carry justified_by', () => {
    for (const kind of ['MRD', 'PRD', 'FR', 'BC'] as const) {
      expect(templateFor(kind)).toContain('justified_by: []');
    }
  });

  test('BC template has the four sections checkBusinessCase (SDD-023) will require', () => {
    const src = templateFor('BC');
    for (const heading of ['## Problema', '## Impacto esperado', '## Métrica de éxito', '## Costo estimado']) {
      expect(src).toContain(heading);
    }
  });

  // The template is the starting point of the editor and the MCP (`prdm://templates/{kind}`),
  // so it must not contradict the publish gate (SDD-124 decision 5).
  test('cada plantilla trae las secciones que su propio chequeo exige (WO-804)', () => {
    for (const kind of AUTHORABLE_KINDS) {
      expect(missingSections(kind, templateBody(kind)), kind).toEqual([]);
    }
  });

  test('la plantilla de FR trae un ítem verificable bajo ## Criterio de aceptación (WO-804)', () => {
    const body = templateBody('FR');
    const afterHeading = body.split('## Criterio de aceptación')[1] ?? '';
    expect(afterHeading).toMatch(/^\s*- \[ \]/m);
  });

  test('la plantilla de PRD reemplazó las secciones viejas por las de SDD-124 (WO-804)', () => {
    const body = templateBody('PRD');
    for (const heading of REQUIRED_SECTIONS.PRD) expect(body).toContain(heading);
    for (const old of ['## Resumen', '## Requisitos', '## Fuera de alcance']) expect(body).not.toContain(old);
  });

  test('WO is excluded from TEMPLATES and isTemplateKind', () => {
    expect(Object.keys(TEMPLATES)).not.toContain('WO');
    expect(isTemplateKind('WO')).toBe(false);
    for (const kind of DOC_KINDS) {
      if (kind !== 'WO') expect(isTemplateKind(kind)).toBe(true);
    }
  });
});
