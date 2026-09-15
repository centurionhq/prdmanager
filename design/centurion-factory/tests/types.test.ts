import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATIONS, STATION_LABELS } from '../src/data/types';

describe('mock domain types', () => {
  it('mirrors @prdm/core and @prdm/contracts without importing them (ADR-007 isolation)', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/data/types.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+'@prdm\//);
  });

  it('lists the six PRD-002 lifecycle stations in order with sentence-case labels', () => {
    expect(STATIONS).toEqual(['ingesta', 'definicion', 'diseno', 'planificacion', 'ejecucion', 'cierre']);
    expect(STATIONS.map((station) => STATION_LABELS[station])).toEqual([
      'Ingesta',
      'Definición',
      'Diseño',
      'Planificación',
      'Ejecución',
      'Cierre',
    ]);
  });
});
