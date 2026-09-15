import { describe, expect, it } from 'vitest';
import type { WorkOrder } from '../../../src/data';
import { CURRENT_ACTOR, filterWorkOrders, statusCounts, statusTotal, type OrdenesFilters } from '../../../src/features/ordenes/filters';

function order(overrides: Partial<WorkOrder>): WorkOrder {
  return {
    id: 'WO-001',
    title: 'Título',
    status: 'pending',
    blueprintId: 'SDD-001',
    featureId: 'PRD-001',
    objective: '',
    criteria: [],
    governedPaths: [],
    commitShas: [],
    updatedAt: '2026-09-10T00:00:00.000Z',
    sample: true,
    ...overrides,
  };
}

const ORDERS: readonly WorkOrder[] = [
  order({ id: 'WO-001', status: 'pending', blueprintId: 'SDD-001', featureId: 'PRD-001' }),
  order({ id: 'WO-002', status: 'in_progress', blueprintId: 'SDD-002', featureId: 'PRD-002', assignedTo: 'agent:claude', title: 'Escaneo incremental' }),
  order({ id: 'WO-003', status: 'out_of_sync', blueprintId: 'SDD-002', featureId: 'PRD-002', assignedTo: 'dev:martin' }),
  order({ id: 'WO-004', status: 'done', blueprintId: 'SDD-001', featureId: 'PRD-001', assignedTo: 'dev:martin' }),
];

function filters(overrides: Partial<OrdenesFilters> = {}): OrdenesFilters {
  return { status: 'todas', blueprintId: 'todos', assignee: 'todas', query: '', ...overrides };
}

describe('filterWorkOrders', () => {
  it('returns every order for the default filters', () => {
    expect(filterWorkOrders(ORDERS, filters())).toHaveLength(4);
  });

  it('filters by status', () => {
    expect(filterWorkOrders(ORDERS, filters({ status: 'done' })).map((o) => o.id)).toEqual(['WO-004']);
  });

  it('filters by blueprint', () => {
    expect(filterWorkOrders(ORDERS, filters({ blueprintId: 'SDD-002' })).map((o) => o.id)).toEqual(['WO-002', 'WO-003']);
  });

  it('filters by feature (deep link from the Árbol)', () => {
    expect(filterWorkOrders(ORDERS, filters({ featureId: 'PRD-002' })).map((o) => o.id)).toEqual(['WO-002', 'WO-003']);
  });

  it('filters by assignee: agentes', () => {
    expect(filterWorkOrders(ORDERS, filters({ assignee: 'agentes' })).map((o) => o.id)).toEqual(['WO-002']);
  });

  it('filters by assignee: developers', () => {
    expect(filterWorkOrders(ORDERS, filters({ assignee: 'developers' })).map((o) => o.id)).toEqual(['WO-003', 'WO-004']);
  });

  it('filters by assignee: sin-asignar', () => {
    expect(filterWorkOrders(ORDERS, filters({ assignee: 'sin-asignar' })).map((o) => o.id)).toEqual(['WO-001']);
  });

  it('filters by search query across id, title, blueprint and assignee', () => {
    expect(filterWorkOrders(ORDERS, filters({ query: 'incremental' })).map((o) => o.id)).toEqual(['WO-002']);
    expect(filterWorkOrders(ORDERS, filters({ query: 'martin' })).map((o) => o.id)).toEqual(['WO-003', 'WO-004']);
  });

  it('combines status, blueprint and assignee filters with a logical AND', () => {
    const result = filterWorkOrders(ORDERS, filters({ status: 'out_of_sync', blueprintId: 'SDD-002', assignee: 'developers' }));
    expect(result.map((o) => o.id)).toEqual(['WO-003']);
  });

  it('the "mias" chip matches only the current demo actor, which no mock order has', () => {
    expect(filterWorkOrders(ORDERS, filters({ status: 'mias' }))).toEqual([]);
    expect(ORDERS.some((o) => o.assignedTo === CURRENT_ACTOR)).toBe(false);
  });
});

describe('statusCounts', () => {
  it('counts every status chip against the other active filters, ignoring the chip itself', () => {
    const counts = statusCounts(ORDERS, filters({ blueprintId: 'SDD-002' }));
    expect(counts.todas).toBe(2);
    expect(counts.pending).toBe(0);
    expect(counts.in_progress).toBe(1);
    expect(counts.out_of_sync).toBe(1);
    expect(counts.done).toBe(0);
    expect(counts.mias).toBe(0);
  });
});

describe('statusTotal', () => {
  it('counts a status across the whole set, ignoring blueprint/assignee/search', () => {
    expect(statusTotal(ORDERS, 'todas')).toBe(4);
    expect(statusTotal(ORDERS, 'out_of_sync')).toBe(1);
  });
});
