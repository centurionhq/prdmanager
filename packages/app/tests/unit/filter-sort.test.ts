import { describe, expect, it } from 'vitest';
import { filterItems, normalize, searchItems, sortItems, toggleSort } from '../../src/lib/filter-sort.js';

interface Order {
  readonly id: string;
  readonly title: string;
  readonly assignee?: string;
  readonly updatedAt?: string;
}

const orders: readonly Order[] = [
  { id: 'WO-304', title: 'Escaneo incremental por hash de archivo', assignee: 'agent:claude', updatedAt: '2026-09-14' },
  { id: 'WO-310', title: 'Resumen del importador en la CLI', assignee: 'agent:claude', updatedAt: '2026-09-15' },
  { id: 'WO-307', title: 'Reintento de subida con idempotencia', assignee: 'dev:martin', updatedAt: undefined },
  { id: 'WO-311', title: 'Test de importación de 2.000 documentos', assignee: undefined, updatedAt: '2026-09-01' },
];

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('Importación')).toBe('importacion');
  });

  it('leaves plain ascii lowercase text untouched', () => {
    expect(normalize('drift')).toBe('drift');
  });
});

describe('searchItems', () => {
  const fields = (order: Order): readonly string[] => [order.id, order.title, order.assignee ?? ''];

  it('matches accent-insensitively', () => {
    const result = searchItems(orders, 'importador', fields);
    expect(result.map((order) => order.id)).toEqual(['WO-310']);
  });

  it('matches a query typed without accents against accented content', () => {
    const result = searchItems(orders, 'importacion', fields);
    expect(result.map((order) => order.id)).toEqual(['WO-311']);
  });

  it('matches case-insensitively', () => {
    const result = searchItems(orders, 'RESUMEN', fields);
    expect(result.map((order) => order.id)).toEqual(['WO-310']);
  });

  it('requires every whitespace-separated term to match some field', () => {
    const result = searchItems(orders, 'wo-304 hash', fields);
    expect(result.map((order) => order.id)).toEqual(['WO-304']);
  });

  it('returns no items when one term matches nothing', () => {
    const result = searchItems(orders, 'hash inexistente', fields);
    expect(result).toEqual([]);
  });

  it('returns every item for an empty query', () => {
    const result = searchItems(orders, '   ', fields);
    expect(result).toEqual(orders);
  });
});

describe('filterItems', () => {
  it('keeps items that satisfy every predicate', () => {
    const result = filterItems(orders, [(order) => order.assignee === 'agent:claude', (order) => order.id !== 'WO-304']);
    expect(result.map((order) => order.id)).toEqual(['WO-310']);
  });

  it('returns every item when no predicates are given', () => {
    const result = filterItems(orders, []);
    expect(result).toEqual(orders);
  });
});

describe('sortItems', () => {
  it('sorts strings ascending using the es locale', () => {
    const result = sortItems(orders, (order) => order.id, 'asc');
    expect(result.map((order) => order.id)).toEqual(['WO-304', 'WO-307', 'WO-310', 'WO-311']);
  });

  it('sorts strings descending', () => {
    const result = sortItems(orders, (order) => order.id, 'desc');
    expect(result.map((order) => order.id)).toEqual(['WO-311', 'WO-310', 'WO-307', 'WO-304']);
  });

  it('places undefined values last regardless of direction', () => {
    const ascending = sortItems(orders, (order) => order.updatedAt, 'asc');
    expect(ascending.at(-1)?.id).toBe('WO-307');

    const descending = sortItems(orders, (order) => order.updatedAt, 'desc');
    expect(descending.at(-1)?.id).toBe('WO-307');
  });

  it('never mutates the input array', () => {
    const copy = [...orders];
    sortItems(orders, (order) => order.id, 'desc');
    expect(orders).toEqual(copy);
  });

  it('is stable for equal values', () => {
    const items = [
      { id: 'a', group: 1 },
      { id: 'b', group: 1 },
      { id: 'c', group: 1 },
    ];
    const result = sortItems(items, (item) => item.group, 'asc');
    expect(result.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('toggleSort', () => {
  it('starts ascending when sorting by a new key', () => {
    expect(toggleSort(undefined, 'title')).toEqual({ key: 'title', direction: 'asc' });
  });

  it('flips direction when toggling the same key', () => {
    const first = toggleSort(undefined, 'title');
    const second = toggleSort(first, 'title');
    expect(second).toEqual({ key: 'title', direction: 'desc' });
  });

  it('resets to ascending when switching to a different key', () => {
    const first = toggleSort(undefined, 'title');
    const switched = toggleSort(first, 'updatedAt');
    expect(switched).toEqual({ key: 'updatedAt', direction: 'asc' });
  });
});
