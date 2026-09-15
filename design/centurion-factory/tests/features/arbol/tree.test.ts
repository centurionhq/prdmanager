import { describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/data';
import { applyKeyboardMove, buildTree, expandableIds, flattenVisible } from '../../../src/features/arbol/tree';

function feature(id: string, evolvesFrom: string | undefined, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    kind: 'PRD',
    title: id,
    status: 'approved',
    station: 'ejecucion',
    evolvesFrom,
    justifiedBy: [],
    blueprintIds: [],
    createdAt: '2026-09-12',
    sample: false,
    ...overrides,
  };
}

// A: root
//   B: child of A
//     D, E: children of B
//   C: child of A (leaf)
const FEATURES: readonly Feature[] = [
  feature('A', undefined),
  feature('B', 'A'),
  feature('C', 'A'),
  feature('D', 'B'),
  feature('E', 'B'),
];

describe('buildTree', () => {
  it('groups features under their evolvesFrom parent, preserving order', () => {
    const tree = buildTree(FEATURES);
    expect(tree.map((node) => node.feature.id)).toEqual(['A']);
    expect(tree[0]?.children.map((node) => node.feature.id)).toEqual(['B', 'C']);
    expect(tree[0]?.children[0]?.children.map((node) => node.feature.id)).toEqual(['D', 'E']);
  });
});

describe('flattenVisible', () => {
  const tree = buildTree(FEATURES);

  it('shows every node when everything is expanded', () => {
    const rows = flattenVisible(tree, new Set(['A', 'B']));
    expect(rows.map((row) => row.feature.id)).toEqual(['A', 'B', 'D', 'E', 'C']);
  });

  it('hides descendants of a collapsed node', () => {
    const rows = flattenVisible(tree, new Set(['A']));
    expect(rows.map((row) => row.feature.id)).toEqual(['A', 'B', 'C']);
  });

  it('computes depth, hasChildren, setSize and posInSet', () => {
    const rows = flattenVisible(tree, new Set(['A', 'B']));
    const b = rows.find((row) => row.feature.id === 'B');
    expect(b).toMatchObject({ depth: 1, hasChildren: true, setSize: 2, posInSet: 1 });
    const e = rows.find((row) => row.feature.id === 'E');
    expect(e).toMatchObject({ depth: 2, hasChildren: false, setSize: 2, posInSet: 2 });
  });
});

describe('expandableIds', () => {
  it('lists every id that has at least one child', () => {
    expect(new Set(expandableIds(FEATURES))).toEqual(new Set(['A', 'B']));
  });
});

describe('applyKeyboardMove', () => {
  const fullyExpanded = new Set(['A', 'B']);

  it('ArrowDown moves to the next visible row', () => {
    const result = applyKeyboardMove({ key: 'ArrowDown', focusedId: 'A', features: FEATURES, expanded: fullyExpanded });
    expect(result?.nextFocusedId).toBe('B');
  });

  it('ArrowDown stays on the last row', () => {
    const result = applyKeyboardMove({ key: 'ArrowDown', focusedId: 'C', features: FEATURES, expanded: fullyExpanded });
    expect(result?.nextFocusedId).toBe('C');
  });

  it('ArrowUp moves to the previous visible row', () => {
    const result = applyKeyboardMove({ key: 'ArrowUp', focusedId: 'D', features: FEATURES, expanded: fullyExpanded });
    expect(result?.nextFocusedId).toBe('B');
  });

  it('ArrowUp stays on the first row', () => {
    const result = applyKeyboardMove({ key: 'ArrowUp', focusedId: 'A', features: FEATURES, expanded: fullyExpanded });
    expect(result?.nextFocusedId).toBe('A');
  });

  it('Home jumps to the first visible row', () => {
    const result = applyKeyboardMove({ key: 'Home', focusedId: 'E', features: FEATURES, expanded: fullyExpanded });
    expect(result?.nextFocusedId).toBe('A');
  });

  it('End jumps to the last visible row', () => {
    const result = applyKeyboardMove({ key: 'End', focusedId: 'A', features: FEATURES, expanded: fullyExpanded });
    expect(result?.nextFocusedId).toBe('C');
  });

  it('ArrowRight expands a collapsed node without moving focus', () => {
    const result = applyKeyboardMove({ key: 'ArrowRight', focusedId: 'B', features: FEATURES, expanded: new Set(['A']) });
    expect(result?.nextFocusedId).toBe('B');
    expect(result?.nextExpanded?.has('B')).toBe(true);
  });

  it('ArrowRight moves to the first child of an already-expanded node', () => {
    const result = applyKeyboardMove({ key: 'ArrowRight', focusedId: 'B', features: FEATURES, expanded: new Set(['A', 'B']) });
    expect(result?.nextFocusedId).toBe('D');
  });

  it('ArrowRight does nothing on a leaf', () => {
    const result = applyKeyboardMove({ key: 'ArrowRight', focusedId: 'C', features: FEATURES, expanded: fullyExpanded });
    expect(result).toBeUndefined();
  });

  it('ArrowLeft collapses an expanded node without moving focus', () => {
    const result = applyKeyboardMove({ key: 'ArrowLeft', focusedId: 'B', features: FEATURES, expanded: new Set(['A', 'B']) });
    expect(result?.nextFocusedId).toBe('B');
    expect(result?.nextExpanded?.has('B')).toBe(false);
  });

  it('ArrowLeft on a collapsed or leaf node moves to its parent', () => {
    const result = applyKeyboardMove({ key: 'ArrowLeft', focusedId: 'D', features: FEATURES, expanded: new Set(['A', 'B']) });
    expect(result?.nextFocusedId).toBe('B');
  });

  it('ArrowLeft on a root node does nothing', () => {
    const result = applyKeyboardMove({ key: 'ArrowLeft', focusedId: 'A', features: FEATURES, expanded: new Set() });
    expect(result).toBeUndefined();
  });

  it('returns undefined for an id that is not visible', () => {
    const result = applyKeyboardMove({ key: 'ArrowDown', focusedId: 'ghost', features: FEATURES, expanded: fullyExpanded });
    expect(result).toBeUndefined();
  });
});
