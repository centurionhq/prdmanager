import { describe, expect, it } from 'vitest';
import { BC_REQUIRED_SECTIONS, DOC_KINDS, MISSING_SECTIONS_MESSAGE, REQUIRED_SECTIONS, missingSections } from '../../src/domain/index.js';

describe('required-sections (WO-801/SDD-124)', () => {
  it('REQUIRED_SECTIONS declara una lista para cada DocKind', () => {
    for (const kind of DOC_KINDS) {
      expect(Array.isArray(REQUIRED_SECTIONS[kind]), kind).toBe(true);
    }
  });

  it('missingSections lista sólo los headings exactos que faltan', () => {
    const body = ['## Problema', 'texto', '  ## Impacto esperado  ', '## Métrica de éxito extra'].join('\n');
    expect(missingSections('BC', body)).toEqual(['## Métrica de éxito', '## Costo estimado']);
  });

  it('missingSections devuelve [] para un kind sin secciones obligatorias', () => {
    expect(missingSections('MRD', '')).toEqual([]);
  });

  it('MISSING_SECTIONS_MESSAGE arma el mensaje del contrato', () => {
    expect(MISSING_SECTIONS_MESSAGE('BC-001', ['## Costo estimado'])).toBe('BC-001 is missing required section(s): ## Costo estimado');
    expect(MISSING_SECTIONS_MESSAGE('BC-001', ['## A', '## B'])).toBe('BC-001 is missing required section(s): ## A, ## B');
  });

  it('BC_REQUIRED_SECTIONS sigue publicando las cuatro secciones del caso de negocio', () => {
    expect([...BC_REQUIRED_SECTIONS]).toEqual(['## Problema', '## Impacto esperado', '## Métrica de éxito', '## Costo estimado']);
  });
});
