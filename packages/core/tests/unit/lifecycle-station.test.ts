import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { deriveLineBoard } from '../../src/lifecycle/station.js';

const prd = (extra = ''): ParsedDoc => doc(`id: PRD-001\ntype: PRD\ntitle: Product\n${extra}`);
const fr = (extra = ''): ParsedDoc => doc(`id: FR-001\ntype: FR\ntitle: Request\n${extra}`);
const bc = (extra = ''): ParsedDoc => doc(`id: BC-001\ntype: BC\ntitle: Business case\n${extra}`);
const sdd = (extra = '', architects = 'PRD-001'): ParsedDoc => doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [${architects}]\n${extra}`);
const wo = (id: string, status: string): ParsedDoc => doc(`id: ${id}\ntype: WO\ntitle: Task ${id}\nstatus: ${status}\nimplements: [SDD-001]\n`, 'task');
const fb = (extra = ''): ParsedDoc => doc(`id: FB-001\ntype: FB\ntitle: Feedback\n${extra}`);

function stationOf(docs: ParsedDoc[], id = 'PRD-001'): string | undefined {
  return deriveLineBoard(docs).features.find((f) => f.id === id)?.station;
}

/** Same as {@link stationOf}, but also looks inside a BC row's `children` (WO-443's row collapsing means
 * a nested PRD doesn't have a top-level row of its own). */
function stationOfDeep(docs: ParsedDoc[], id: string): string | undefined {
  for (const feature of deriveLineBoard(docs).features) {
    if (feature.id === id) return feature.station;
    const child = feature.children.find((c) => c.id === id);
    if (child) return child.station;
  }
  return undefined;
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

  test('caso_negocio: an approved BC with no PRD is still parked at Caso de negocio (PRD-011 §4.4)', () => {
    expect(stationOf([bc('status: approved')], 'BC-001')).toBe('caso_negocio');
  });

  test('entregado: a closed BC', () => {
    expect(stationOf([bc('status: closed')], 'BC-001')).toBe('entregado');
  });
});

describe('deriveLineBoard — colapso de filas del BC (WO-443, SDD-024/PRD-011 §4.4)', () => {
  test('BC sin PRD: una sola fila, sin children', () => {
    const board = deriveLineBoard([bc('status: approved')]);
    expect(board.features).toEqual([{ id: 'BC-001', kind: 'BC', title: 'Business case', status: 'approved', station: 'caso_negocio', progress: { done: 0, total: 0, stopped: 0 }, children: [] }]);
  });

  test('un PRD cuyo justified_by resuelve a un BC presente no tiene fila propia: aparece anidado', () => {
    const board = deriveLineBoard([bc('status: approved'), prd('justified_by: [BC-001]')]);
    expect(board.features.map((f) => f.id)).toEqual(['BC-001']);
    expect(board.features[0]?.children.map((c) => c.id)).toEqual(['PRD-001']);
  });

  test('producto: el PRD anidado está aprobado, sin blueprint todavía', () => {
    expect(stationOf([bc('status: approved'), prd('justified_by: [BC-001]\nstatus: approved')], 'BC-001')).toBe('producto');
  });

  test('diseno_tecnico: un blueprint architecta al PRD anidado', () => {
    const docs = [bc('status: approved'), prd('justified_by: [BC-001]\nstatus: approved'), sdd()];
    expect(stationOf(docs, 'BC-001')).toBe('diseno_tecnico');
  });

  test('planificacion: hay WOs generadas para el PRD anidado, todas pendientes', () => {
    const docs = [bc('status: approved'), prd('justified_by: [BC-001]\nstatus: approved'), sdd(), wo('WO-001', 'pending')];
    expect(stationOf(docs, 'BC-001')).toBe('planificacion');
  });

  test('construccion: una WO del PRD anidado está in_progress', () => {
    const docs = [bc('status: approved'), prd('justified_by: [BC-001]\nstatus: approved'), sdd(), wo('WO-001', 'in_progress')];
    expect(stationOf(docs, 'BC-001')).toBe('construccion');
  });

  test('entregado: todas las WOs del PRD anidado están done', () => {
    const docs = [bc('status: approved'), prd('justified_by: [BC-001]\nstatus: approved'), sdd(), wo('WO-001', 'done')];
    expect(stationOf(docs, 'BC-001')).toBe('entregado');
  });

  test('entregado: el propio BC está cerrado, sin importar el estado del PRD', () => {
    const docs = [bc('status: closed'), prd('justified_by: [BC-001]')];
    expect(stationOf(docs, 'BC-001')).toBe('entregado');
  });

  test('el PRD anidado conserva su propia estación intrínseca dentro de children', () => {
    const board = deriveLineBoard([bc('status: approved'), prd('justified_by: [BC-001]\nstatus: approved')]);
    expect(board.features[0]?.children).toEqual([{ id: 'PRD-001', kind: 'PRD', title: 'Product', status: 'approved', station: 'diseno_tecnico', progress: { done: 0, total: 0, stopped: 0 }, children: [] }]);
  });

  test('PRD legacy sin BC: conserva su fila propia y su progreso de siempre', () => {
    const board = deriveLineBoard([prd('status: approved')]);
    expect(board.features).toEqual([{ id: 'PRD-001', kind: 'PRD', title: 'Product', status: 'approved', station: 'diseno_tecnico', progress: { done: 0, total: 0, stopped: 0 }, children: [] }]);
  });

  test('un PRD legacy y una iniciativa con BC conviven, cada una en su propia fila de nivel superior', () => {
    const bc2 = doc('id: BC-002\ntype: BC\ntitle: Other business case\nstatus: approved');
    const prd2 = doc('id: PRD-002\ntype: PRD\ntitle: Other\njustified_by: [BC-002]');
    const board = deriveLineBoard([prd('status: approved'), bc2, prd2]);
    expect(board.features.map((f) => f.id)).toEqual(['PRD-001', 'BC-002']);
    expect(board.features[1]?.children.map((c) => c.id)).toEqual(['PRD-002']);
  });

  test('ningún documento aparece dos veces en el board', () => {
    const board = deriveLineBoard([bc('status: approved'), prd('justified_by: [BC-001]')]);
    const allIds = [...board.features.map((f) => f.id), ...board.features.flatMap((f) => f.children.map((c) => c.id))];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  test('un PRD con justified_by apuntando a un id que no existe en docs conserva su fila propia', () => {
    // justified_by no resuelve a ningún doc presente -> no hay BC que lo anide, pero isJustified ya
    // cuenta un justified_by no vacío como justificación (comportamiento previo a WO-443, sin cambios).
    expect(stationOfDeep([prd('justified_by: [BC-999]')], 'PRD-001')).toBe('producto');
  });
});

describe('deriveLineBoard — colapso de filas de FR (WO-450, SDD-025)', () => {
  test('un FR cuyo justified_by resuelve a un BC presente no tiene fila propia: aparece anidado', () => {
    const board = deriveLineBoard([bc('status: approved'), fr('justified_by: [BC-001]')]);
    expect(board.features.map((f) => f.id)).toEqual(['BC-001']);
    expect(board.features[0]?.children.map((c) => c.id)).toEqual(['FR-001']);
  });

  test('producto: el FR anidado está aprobado, sin blueprint todavía', () => {
    expect(stationOf([bc('status: approved'), fr('justified_by: [BC-001]\nstatus: approved')], 'BC-001')).toBe('producto');
  });

  test('diseno_tecnico: un blueprint architecta al FR anidado', () => {
    const sddArchitectsFr = doc('id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [FR-001]');
    const docs = [bc('status: approved'), fr('justified_by: [BC-001]\nstatus: approved'), sddArchitectsFr];
    expect(stationOf(docs, 'BC-001')).toBe('diseno_tecnico');
  });

  test('FR legacy sin BC: conserva su fila propia y su progreso de siempre', () => {
    const board = deriveLineBoard([fr('status: approved')]);
    expect(board.features).toEqual([{ id: 'FR-001', kind: 'FR', title: 'Request', status: 'approved', station: 'diseno_tecnico', progress: { done: 0, total: 0, stopped: 0 }, children: [] }]);
  });

  test('un PRD y un FR distintos, ambos anidados bajo el mismo BC', () => {
    const docs = [bc('status: approved'), prd('justified_by: [BC-001]'), fr('justified_by: [BC-001]')];
    const board = deriveLineBoard(docs);
    expect(board.features.map((f) => f.id)).toEqual(['BC-001']);
    expect(board.features[0]?.children.map((c) => c.id).sort()).toEqual(['FR-001', 'PRD-001']);
  });

  test('ningún documento aparece dos veces en el board cuando un FR cuelga de un BC', () => {
    const board = deriveLineBoard([bc('status: approved'), fr('justified_by: [BC-001]')]);
    const allIds = [...board.features.map((f) => f.id), ...board.features.flatMap((f) => f.children.map((c) => c.id))];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
