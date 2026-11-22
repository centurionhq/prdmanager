/**
 * WO-705 (SDD-091 D5): the audit filters live in the URL (`?accion=&desde=&hasta=&actor=`) so reloading or
 * sharing the link reproduces the cut. This module is the pure half — params in, state out, and back — so the
 * round trip (including the values a hand-edited URL can carry) is testable without React.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_AUDIT_FILTERS,
  applyAuditFilters,
  formatActorValue,
  hasAuditFilters,
  parseActorValue,
  parseAuditDate,
  parseAuditFilters,
  toAuditQuery,
  type AuditFilterState,
} from '../../src/routes/audit/filters.js';

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe('audit filters in the URL (WO-705)', () => {
  it('writes the four filters under their Spanish params, and reads them back unchanged', () => {
    const state: AuditFilterState = { action: 'drift.acknowledged', from: '2026-03-01', to: '2026-03-07', actor: 'user:u1' };

    const written = applyAuditFilters(new URLSearchParams(), state);

    expect(written.get('accion')).toBe('drift.acknowledged');
    expect(written.get('desde')).toBe('2026-03-01');
    expect(written.get('hasta')).toBe('2026-03-07');
    expect(written.get('actor')).toBe('user:u1');
    expect(parseAuditFilters(written)).toEqual(state);
  });

  it('an empty filter writes no params at all, and leaving one out of the URL reads back empty', () => {
    const written = applyAuditFilters(new URLSearchParams(), EMPTY_AUDIT_FILTERS);

    expect(written.toString()).toBe('');
    expect(parseAuditFilters(new URLSearchParams())).toEqual(EMPTY_AUDIT_FILTERS);
  });

  it('clearing a filter removes its param instead of leaving `accion=` behind', () => {
    const previous = params({ accion: 'wo.claim', desde: '2026-03-01', page: '2' });

    const written = applyAuditFilters(previous, { ...EMPTY_AUDIT_FILTERS });

    expect(written.get('accion')).toBeNull();
    expect(written.get('desde')).toBeNull();
    expect(written.get('page')).toBe('2');
  });

  it('leaves unrelated params alone, so the filter never drops what another screen put there', () => {
    const written = applyAuditFilters(params({ q: 'texto' }), { action: 'wo.claim', from: '', to: '', actor: '' });

    expect(written.get('q')).toBe('texto');
    expect(written.get('accion')).toBe('wo.claim');
    expect(parseAuditFilters(written).action).toBe('wo.claim');
  });

  it('trims the action and caps it at the length the server accepts', () => {
    const written = applyAuditFilters(new URLSearchParams(), { ...EMPTY_AUDIT_FILTERS, action: `  ${'x'.repeat(200)}  ` });

    expect(written.get('accion')).toHaveLength(120);
  });

  it('discards a garbage date instead of breaking the screen: a bad `desde` reads back empty', () => {
    expect(parseAuditFilters(params({ desde: 'ayer' })).from).toBe('');
    expect(parseAuditFilters(params({ hasta: '2026-02-31' })).to).toBe('');
    expect(parseAuditFilters(params({ hasta: '2026-13-01' })).to).toBe('');
    expect(applyAuditFilters(params({ desde: 'lunes' }), { ...EMPTY_AUDIT_FILTERS, from: 'lunes' }).get('desde')).toBeNull();
  });

  it('keeps a real calendar date, including a leap day', () => {
    expect(parseAuditDate('2028-02-29')).toBe('2028-02-29');
    expect(parseAuditDate('2026-02-29')).toBe('');
    expect(parseAuditFilters(params({ desde: '2028-02-29' })).from).toBe('2028-02-29');
  });

  it('discards an actor that is not a `tipo:id` pair', () => {
    expect(parseAuditFilters(params({ actor: 'ana' })).actor).toBe('');
    expect(parseAuditFilters(params({ actor: 'user:' })).actor).toBe('');
    expect(parseAuditFilters(params({ actor: ':u1' })).actor).toBe('');
    expect(parseAuditFilters(params({ actor: 'user:u1' })).actor).toBe('user:u1');
  });

  it('splits the actor at the first colon, so an id that carries one survives', () => {
    expect(parseActorValue('agent:claude:opus')).toEqual({ type: 'agent', id: 'claude:opus' });
    expect(parseActorValue('ana')).toBeNull();
    expect(formatActorValue({ type: 'user', id: 'u1' })).toBe('user:u1');
  });

  it('maps the state to the server params: action, from/to and actorType+actorId', () => {
    expect(toAuditQuery({ action: 'wo.claim', from: '2026-03-01', to: '2026-03-07', actor: 'agent:claude' })).toEqual({
      action: 'wo.claim',
      from: '2026-03-01',
      to: '2026-03-07',
      actorType: 'agent',
      actorId: 'claude',
    });
  });

  it('sends only the filters that are set, so an empty screen asks for the unfiltered log', () => {
    expect(toAuditQuery(EMPTY_AUDIT_FILTERS)).toEqual({});
    expect(toAuditQuery({ action: '', from: '2026-03-01', to: '', actor: '' })).toEqual({ from: '2026-03-01' });
  });

  it('knows whether anything is filtered, which is what the «Quitar filtros» button hangs on', () => {
    expect(hasAuditFilters(EMPTY_AUDIT_FILTERS)).toBe(false);
    expect(hasAuditFilters({ ...EMPTY_AUDIT_FILTERS, to: '2026-03-07' })).toBe(true);
    expect(hasAuditFilters({ ...EMPTY_AUDIT_FILTERS, actor: 'user:u1' })).toBe(true);
  });
});
