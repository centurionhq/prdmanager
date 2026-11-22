import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import { computeCapacities } from '../../src/lifecycle/check.js';

const NOW = new Date('2026-11-22T12:00:00Z');
const D3 = '2026-11-19T10:00:00Z';
const D20 = '2026-11-02T10:00:00Z';

const fr = (id: string, createdAt: string, body = 'body') => doc(`id: ${id}\ntype: FR\ntitle: Request\ncreated_at: ${createdAt}`, body);
const sdd = (id: string, architects: string, createdAt = D20) =>
  doc(`id: ${id}\ntype: SDD\ntitle: Design\narchitects: [${architects}]\nimpacts_paths: ["a/**"]\ncreated_at: ${createdAt}`);
const wo = (id: string, status: string, implementsId: string, extra = '') =>
  doc(`id: ${id}\ntype: WO\ntitle: Task\nstatus: ${status}\nimplements: [${implementsId}]\n${extra}`);
const fb = (id: string, status: string, createdAt: string, extra = '') =>
  doc(`id: ${id}\ntype: FB\ntitle: Feedback\nstatus: ${status}\ncreated_at: ${createdAt}\n${extra}`);

const w7 = (docs: Parameters<typeof computeCapacities>[0]) => computeCapacities(docs, NOW).windows[0]!;
const w30 = (docs: Parameters<typeof computeCapacities>[0]) => computeCapacities(docs, NOW).windows[1]!;

describe('computeCapacities', () => {
  test('always ships 2 windows and the 7 kinds with zero for absent ones', () => {
    const { windows } = computeCapacities([], NOW);
    expect(windows.map((w) => w.days)).toEqual([7, 30]);
    expect(windows[0]!.createdByKind.map((k) => k.kind)).toEqual(['PRD', 'FR', 'SDD', 'ADR', 'WO', 'BC', 'FB']);
    expect(windows[0]!.features.map((f) => f.kind)).toEqual(['PRD', 'FR']);
  });

  test('windows by created_at: 3 days old is in both, 20 days old only in 30', () => {
    const docs = [fr('FR-001', D3), fr('FR-002', D20), fb('FB-001', 'new', D3), doc(`id: BC-001\ntype: BC\ntitle: b\ncreated_at: ${D20}`)];
    const total = (w: ReturnType<typeof w7>, kind: string) => w.createdByKind.find((k) => k.kind === kind)!.total;
    expect(total(w7(docs), 'FR')).toBe(1);
    expect(total(w30(docs), 'FR')).toBe(2);
    expect(total(w7(docs), 'BC')).toBe(0);
    expect(total(w30(docs), 'BC')).toBe(1);
    expect(total(w7(docs), 'FB')).toBe(1);
    expect(w30(docs).createdByKind.reduce((n, k) => n + k.total, 0)).toBe(4);
  });

  test('documents without created_at fall outside every window', () => {
    const docs = [doc('id: FR-001\ntype: FR\ntitle: Request')];
    expect(w30(docs).createdByKind.every((k) => k.total === 0)).toBe(true);
  });

  test('FR with no blueprint has withDesign 0; with blueprint but no WO has withWorkOrders 0', () => {
    const line = (docs: Parameters<typeof w7>[0]) => w7(docs).features.find((f) => f.kind === 'FR')!;
    expect(line([fr('FR-001', D3)])).toMatchObject({ created: 1, withDesign: 0, withWorkOrders: 0, delivered: 0 });
    expect(line([fr('FR-001', D3), sdd('SDD-001', 'FR-001')])).toMatchObject({ withDesign: 1, withWorkOrders: 0, delivered: 0 });
  });

  test('delivered when every WO is done with resolved_by; a pending WO breaks it', () => {
    const chain = [fr('FR-001', D3), sdd('SDD-001', 'FR-001'), wo('WO-001', 'done', 'SDD-001', 'resolved_by: [abc1234]')];
    expect(w7(chain).features.find((f) => f.kind === 'FR')).toMatchObject({ withDesign: 1, withWorkOrders: 1, delivered: 1 });
    const withPending = [...chain, wo('WO-002', 'pending', 'SDD-001')];
    expect(w7(withPending).features.find((f) => f.kind === 'FR')).toMatchObject({ withWorkOrders: 1, delivered: 0 });
  });

  test('feedback buckets add up to created, pendingClose counts all FBs outside the window', () => {
    const delivered = [fr('FR-001', D3), sdd('SDD-001', 'FR-001'), wo('WO-001', 'done', 'SDD-001', 'resolved_by: [abc1234]')];
    const open = [...delivered, fb('FB-001', 'new', D20, 'informs: [FR-001]')];
    expect(w7(open).feedback).toMatchObject({ created: 0, pendingClose: 1 });
    const closed = [...delivered, fb('FB-001', 'closed', D3, 'informs: [FR-001]\nclose_reason: ok\nclosed_by: dev:tano')];
    expect(w7(closed).feedback.pendingClose).toBe(0);
    const mix = [fb('FB-001', 'new', D3), fb('FB-002', 'triaged', D3), fb('FB-003', 'dismissed', D3, 'dismiss_reason: x'), fb('FB-004', 'closed', D3)];
    const f = w7(mix).feedback;
    expect(f.created).toBe(4);
    expect(f.new + f.triaged + f.closed).toBe(f.created);
    expect(f).toMatchObject({ new: 1, triaged: 1, closed: 2 });
  });

  test('passageExceptions counts FRs with a non-empty section; empty section is 0', () => {
    expect(w7([fr('FR-001', D3, '## Excepción de pasaje\n\nCambio único\n')]).passageExceptions).toBe(1);
    expect(w7([fr('FR-001', D3, '## Excepción de pasaje\n\n## Otra\n')]).passageExceptions).toBe(0);
    expect(w7([fr('FR-001', D20, '## Excepción de pasaje\n\nCambio único\n')]).passageExceptions).toBe(0);
  });
});
