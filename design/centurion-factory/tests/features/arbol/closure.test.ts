import { describe, expect, it } from 'vitest';
import { getFeature } from '../../../src/data';
import { computeClosureReadiness, passSummary } from '../../../src/features/arbol/closure';

describe('computeClosureReadiness', () => {
  it('reproduces the canvas checklist for FR-001: four checks pass, project_clean fails', () => {
    const feature = getFeature('FR-001');
    if (!feature) throw new Error('FR-001 missing from mock data');
    const result = computeClosureReadiness(feature);

    expect(result.ready).toBe(false);
    expect(result.checks).toEqual([
      { name: 'feature_exists', label: 'La feature existe', ok: true, detail: 'FR-001 existe' },
      { name: 'feature_approved', label: 'Está aprobada', ok: true, detail: 'Estado approved' },
      { name: 'blueprints_have_work_orders', label: 'Cada blueprint tiene órdenes', ok: true, detail: 'SDD-003 tiene 4 órdenes' },
      { name: 'work_orders_done', label: 'Todas las órdenes están hechas', ok: true, detail: '4 de 4 hechas' },
      {
        name: 'project_clean',
        label: 'El proyecto no tiene drift',
        ok: false,
        detail: 'Hay 3 errores de drift en el proyecto. Reconocelos o resolvelos antes de cerrar.',
      },
    ]);
  });

  it('fails feature_approved for a draft feature', () => {
    const feature = getFeature('FR-003');
    if (!feature) throw new Error('FR-003 missing from mock data');
    const result = computeClosureReadiness(feature);
    const approved = result.checks.find((check) => check.name === 'feature_approved');
    expect(approved).toMatchObject({ ok: false, detail: 'Estado draft' });
  });

  it('fails blueprints_have_work_orders for a feature with no blueprints', () => {
    const feature = getFeature('FR-004');
    if (!feature) throw new Error('FR-004 missing from mock data');
    const result = computeClosureReadiness(feature);
    const blueprints = result.checks.find((check) => check.name === 'blueprints_have_work_orders');
    expect(blueprints).toMatchObject({ ok: false, detail: 'La feature todavía no tiene blueprints.' });
  });

  it('treats an already-closed feature as approved for feature_approved', () => {
    const feature = getFeature('PRD-002');
    if (!feature) throw new Error('PRD-002 missing from mock data');
    const result = computeClosureReadiness(feature);
    expect(result.checks.find((check) => check.name === 'feature_approved')).toMatchObject({ ok: true, detail: 'Estado closed' });
  });
});

describe('passSummary', () => {
  it('spells out the pass count in Spanish', () => {
    const feature = getFeature('FR-001');
    if (!feature) throw new Error('FR-001 missing from mock data');
    expect(passSummary(computeClosureReadiness(feature).checks)).toBe('Cuatro de cinco checks pasan');
  });

  it('says Cero when nothing passes', () => {
    expect(
      passSummary([
        { name: 'feature_exists', label: '', ok: false, detail: '' },
        { name: 'feature_approved', label: '', ok: false, detail: '' },
      ]),
    ).toBe('Cero de cinco checks pasan');
  });
});
