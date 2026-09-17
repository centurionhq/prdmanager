import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { deriveLineBoard } from '../../src/lifecycle/station.js';

const prd = (extra = ''): ParsedDoc => doc(`id: PRD-001\ntype: PRD\ntitle: Product\n${extra}`);
const sdd = (extra = ''): ParsedDoc => doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\n${extra}`);
const wo = (id: string, status: string): ParsedDoc => doc(`id: ${id}\ntype: WO\ntitle: Task ${id}\nstatus: ${status}\nimplements: [SDD-001]\n`, 'task');
const fb = (extra = ''): ParsedDoc => doc(`id: FB-001\ntype: FB\ntitle: Feedback\n${extra}`);

function stationOf(docs: ParsedDoc[]): string | undefined {
  return deriveLineBoard(docs).features.find((f) => f.id === 'PRD-001')?.station;
}

describe('deriveLineBoard — station rules', () => {
  test('ingesta: no blueprint, no justification, not approved', () => {
    expect(stationOf([prd()])).toBe('ingesta');
  });

  test('definicion: justified via justified_by', () => {
    expect(stationOf([prd('justified_by: [FB-001]'), fb()])).toBe('definicion');
  });

  test('definicion: justified via a Feedback informing it', () => {
    expect(stationOf([prd(), fb('informs: [PRD-001]')])).toBe('definicion');
  });

  test('diseno: approved even with no blueprint', () => {
    expect(stationOf([prd('status: approved')])).toBe('diseno');
  });

  test('diseno: a blueprint architects it with no work orders yet', () => {
    expect(stationOf([prd(), sdd()])).toBe('diseno');
  });

  test('planificacion: has work orders and all are pending', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'pending'), wo('WO-002', 'pending')])).toBe('planificacion');
  });

  test('ejecucion: one work order in_progress among pending ones', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'pending'), wo('WO-002', 'in_progress')])).toBe('ejecucion');
  });

  test('ejecucion: mixed done and pending (not all done)', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'done'), wo('WO-002', 'pending')])).toBe('ejecucion');
  });

  test('ejecucion: an out_of_sync work order among pending ones', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'pending'), wo('WO-002', 'out_of_sync')])).toBe('ejecucion');
  });

  test('cierre: every reachable work order is done', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'done'), wo('WO-002', 'done')])).toBe('cierre');
  });

  test('cierre: every reachable work order is archived (WO-414/SDD-018: archived is resolved, same as done)', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'archived'), wo('WO-002', 'archived')])).toBe('cierre');
  });

  test('cierre: a mix of done and archived work orders', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'done'), wo('WO-002', 'archived')])).toBe('cierre');
  });

  test('ejecucion: an archived work order among still-pending ones (not all resolved yet)', () => {
    expect(stationOf([prd(), sdd(), wo('WO-001', 'archived'), wo('WO-002', 'pending')])).toBe('ejecucion');
  });

  test('cierre: feature status is closed regardless of work orders', () => {
    expect(stationOf([prd('status: closed')])).toBe('cierre');
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
