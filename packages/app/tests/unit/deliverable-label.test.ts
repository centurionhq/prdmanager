import { describe, expect, it } from 'vitest';
import { asDeliverableKind, DELIVERABLE_COPY, DELIVERABLE_COPY_LIST, DELIVERABLE_FALLBACK_KIND, deliverableCopy } from '../../src/routes/ordenes/deliverable-label.js';

describe('deliverable-label', () => {
  it('has the exact copy for both classes', () => {
    expect(DELIVERABLE_COPY.code).toEqual({ kind: 'code', label: 'Código', legend: 'se cierra con un commit `Refs: WO-xxx`', closesWith: 'commit' });
    expect(DELIVERABLE_COPY.gate).toEqual({
      kind: 'gate',
      label: 'Gate',
      legend: 'se cierra con evidencia (`archive_work_order` + motivo)',
      closesWith: 'evidence',
    });
  });

  it('lists the classes in legend order', () => {
    expect(DELIVERABLE_COPY_LIST.map((copy) => copy.kind)).toEqual(['code', 'gate']);
  });

  it('keeps the known kinds', () => {
    expect(asDeliverableKind('gate')).toBe('gate');
    expect(asDeliverableKind('code')).toBe('code');
  });

  it.each([undefined, null, 'raro', {}, 42])('falls back to code for %o', (value) => {
    expect(DELIVERABLE_FALLBACK_KIND).toBe('code');
    expect(asDeliverableKind(value)).toBe('code');
  });

  it('resolves the copy of an unknown value as code', () => {
    expect(deliverableCopy('raro').label).toBe('Código');
    expect(deliverableCopy('gate').label).toBe('Gate');
  });
});
