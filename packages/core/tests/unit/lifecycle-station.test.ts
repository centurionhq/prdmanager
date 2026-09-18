import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { deriveLineBoard } from '../../src/lifecycle/station.js';

const prd = (extra = ''): ParsedDoc => doc(`id: PRD-001\ntype: PRD\ntitle: Product\n${extra}`);
const bc = (extra = ''): ParsedDoc => doc(`id: BC-001\ntype: BC\ntitle: Business case\n${extra}`);
const sdd = (extra = ''): ParsedDoc => doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\n${extra}`);
const wo = (id: string, status: string): ParsedDoc => doc(`id: ${id}\ntype: WO\ntitle: Task ${id}\nstatus: ${status}\nimplements: [SDD-001]\n`, 'task');
const fb = (extra = ''): ParsedDoc => doc(`id: FB-001\ntype: FB\ntitle: Feedback\n${extra}`);

function stationOf(docs: ParsedDoc[], id = 'PRD-001'): string | undefined {
  return deriveLineBoard(docs).features.find((f) => f.id === id)?.station;
}

describe('deriveLineBoard — station rules', () => {
  test('entrada: no blueprint, no justification, not approved', () => {
    expect(stationOf([prd()])).toBe('entrada');
  });

  test('producto: justified via justified_by', () => {
    expect(stationOf([prd('justified_by: [FB-001]'), fb()])).toBe('producto');
  });

  test('producto: justified via a Feedback informing it', () => {
    expect(stationOf([prd(), fb('informs: [PRD-001]')])).toBe('producto');
  });

  test('diseno_tecnico: approved even with no blueprint', () => {
    expect(stationOf([prd('status: approved')])).toBe('diseno_tecnico');
  });

  test('diseno_tecnico: a blueprint architects it with no work orders yet', () => {
    expect(stationOf([prd(), sdd()])).toBe('diseno_tecnico');
  });

  test('planificacion: has work orders and all are pending', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'pending'), wo('WO-002', 'pending')])).toBe('planificacion');
  });

  test('construccion: one work order in_progress among pending ones', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'pending'), wo('WO-002', 'in_progress')])).toBe('construccion');
  });

  test('construccion: mixed done and pending (not all done)', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'done'), wo('WO-002', 'pending')])).toBe('construccion');
  });

  test('construccion: an out_of_sync work order among pending ones', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'pending'), wo('WO-002', 'out_of_sync')])).toBe('construccion');
  });

  test('entregado: every reachable work order is done', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'done'), wo('WO-002', 'done')])).toBe('entregado');
  });

  test('entregado: every reachable work order is archived (WO-414/SDD-018: archived is resolved, same as done)', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'archived'), wo('WO-002', 'archived')])).toBe('entregado');
  });

  test('entregado: a mix of done and archived work orders', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'done'), wo('WO-002', 'archived')])).toBe('entregado');
  });

  test('construccion: an archived work order among still-pending ones (not all resolved yet)', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'archived'), wo('WO-002', 'pending')])).toBe('construccion');
  });

  test('entregado: feature status is closed regardless of work orders', () => {
    expect(stationOf([prd('status: closed')])).toBe('entregado');
  });

  test('progress counts done/total/stopped across every reachable work order', () => {
    const board = deriveLineBoard([prd(), sdd(), wo('WO-001', 'done'), wo('WO-002', 'pending'), wo('WO-003', 'out_of_sync')]);
    expect(board.features[0]?.progress).toEqual({ done: 1, total: 3, stopped: 1 });
  });

  test('progress counts an archived work order as done (WO-414/SDD-018)', () => {
    const board = deriveLineBoard([prd(), sdd(), wo('WO-001', 'done'), wo('WO-002', 'archived'), wo('WO-003', 'pending')]);
    expect(board.features[0]?.progress).toEqual({ done: 2, total: 3, stopped: 0 });
  });

  test('a feature with no blueprints and no work orders has zeroed progress', () => {
    const board = deriveLineBoard([prd()]);
    expect(board.features[0]?.progress).toEqual({ done: 0, total: 0, stopped: 0 });
  });

  test('deriveLineBoard never sets andon itself', () => {
    expect(deriveLineBoard([prd('status: approved')]).andon).toBeNull();
  });

  test('non-feature documents are excluded from features', () => {
    const board = deriveLineBoard([prd(), sdd(), fb()]);
    expect(board.features.map((f) => f.id)).toEqual(['PRD-001']);
  });
});

describe('deriveLineBoard — estación caso_negocio (BC, WO-442)', () => {
  test('entrada: a BC with no justification yet', () => {
    expect(stationOf([bc()], 'BC-001')).toBe('entrada');
  });

  test('caso_negocio: a BC justified via justified_by ("hay un BC escrito")', () => {
    expect(stationOf([bc('justified_by: [FB-001]'), fb()], 'BC-001')).toBe('caso_negocio');
  });

  test('caso_negocio: a BC justified via an Artifact providing context for it', () => {
    const art = doc('id: ART-001\ntype: ART\ntitle: Call\nsource: call\nprovides_context_for: [BC-001]\n');
    expect(stationOf([bc(), art], 'BC-001')).toBe('caso_negocio');
  });

  test('diseno_tecnico: an approved BC still resolves like any other justified/approved Feature', () => {
    expect(stationOf([bc('status: approved')], 'BC-001')).toBe('diseno_tecnico');
  });

  test('entregado: a closed BC', () => {
    expect(stationOf([bc('status: closed')], 'BC-001')).toBe('entregado');
  });

  test('a BC is included in the board alongside its PRD, each on its own station for now (row nesting is WO-443)', () => {
    const board = deriveLineBoard([bc('status: approved'), prd('justified_by: [BC-001]')]);
    expect(board.features.map((f) => ({ id: f.id, kind: f.kind, station: f.station }))).toEqual([
      { id: 'BC-001', kind: 'BC', station: 'diseno_tecnico' },
      { id: 'PRD-001', kind: 'PRD', station: 'producto' },
    ]);
  });
});
