import { describe, expect, test } from 'vitest';
import type { TreeNode } from '@prdm/core';
import { countMatches, filterForestByQuery, normalizeQuery } from '../../src/routes/arbol/tree-search.js';

function node(ref: string, title: string, children: TreeNode[] = []): TreeNode {
  return { ref, label: 'Feature', kind: 'FR', title, status: 'approved', via: null, edgeStatus: null, reviewNeeded: false, repeated: false, children };
}

const FOREST: TreeNode[] = [
  node('MRD-001', 'Mercado', [node('FR-001', 'Árbol de features'), node('FR-002', 'Importador incremental')]),
  node('MRD-002', 'Otro mercado'),
];

describe('normalizeQuery', () => {
  test('folds case and diacritics, and is idempotent', () => {
    expect(normalizeQuery('Árbol de FEATURES')).toBe('arbol de features');
    expect(normalizeQuery(normalizeQuery('Árbol de FEATURES'))).toBe('arbol de features');
  });
});

describe('filterForestByQuery', () => {
  test('returns a copy of the whole forest for an empty query', () => {
    const result = filterForestByQuery(FOREST, '');
    expect(result).toEqual(FOREST);
    expect(result).not.toBe(FOREST);
  });

  test('matches by ref in lowercase', () => {
    const result = filterForestByQuery(FOREST, 'fr-001');
    expect(result[0]?.children.map((child) => child.ref)).toEqual(['FR-001']);
  });

  test('matches by title ignoring accents and case', () => {
    const result = filterForestByQuery(FOREST, 'ARBOL');
    expect(result[0]?.children.map((child) => child.ref)).toEqual(['FR-001']);
  });

  test("keeps the match's ancestors and drops non-matching siblings", () => {
    const result = filterForestByQuery(FOREST, 'importador');
    expect(result.map((root) => root.ref)).toEqual(['MRD-001']);
    expect(result[0]?.children.map((child) => child.ref)).toEqual(['FR-002']);
  });

  test('returns an empty forest when nothing matches', () => {
    expect(filterForestByQuery(FOREST, 'zzz')).toEqual([]);
  });
});

describe('countMatches', () => {
  test('counts every node including context ancestors, and 0 for an empty forest', () => {
    expect(countMatches(filterForestByQuery(FOREST, 'importador'))).toBe(2);
    expect(countMatches([])).toBe(0);
  });
});
