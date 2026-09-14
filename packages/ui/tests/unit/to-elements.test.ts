import type { Subgraph } from '@prdm/core';
import { describe, expect, it } from 'vitest';
import { toElements } from '../../src/graph/to-elements';

describe('toElements', () => {
  it('maps subgraph nodes to cytoscape node elements', () => {
    const graph: Subgraph = {
      nodes: [{ ref: 'FR-001', label: 'Feature', kind: 'FR', title: 'Search', status: 'active' }],
      edges: [],
    };

    expect(toElements(graph)).toEqual([
      {
        group: 'nodes',
        data: { id: 'FR-001', label: 'Feature', kind: 'FR', title: 'Search', status: 'active' },
      },
    ]);
  });

  it('maps subgraph edges to cytoscape edge elements with a composite id', () => {
    const graph: Subgraph = {
      nodes: [],
      edges: [{ from: 'FR-001', to: 'SDD-005', type: 'implements', status: 'active', reviewNeeded: false }],
    };

    expect(toElements(graph)).toEqual([
      {
        group: 'edges',
        data: {
          id: 'FR-001-implements-SDD-005',
          source: 'FR-001',
          target: 'SDD-005',
          type: 'implements',
          status: 'active',
          reviewNeeded: false,
        },
      },
    ]);
  });

  it('keeps nodes before edges and preserves order', () => {
    const graph: Subgraph = {
      nodes: [
        { ref: 'FR-001', label: 'Feature', kind: 'FR', title: 'Search', status: 'active' },
        { ref: 'SDD-005', label: 'Blueprint', kind: 'SDD', title: 'Explorer', status: 'active' },
      ],
      edges: [{ from: 'FR-001', to: 'SDD-005', type: 'implements', status: 'active', reviewNeeded: true }],
    };

    const elements = toElements(graph);

    expect(elements).toHaveLength(3);
    expect(elements[0]?.group).toBe('nodes');
    expect(elements[1]?.group).toBe('nodes');
    expect(elements[2]?.group).toBe('edges');
  });

  it('produces distinct ids for two different relationship types between the same pair of nodes', () => {
    const graph: Subgraph = {
      nodes: [],
      edges: [
        { from: 'FR-001', to: 'FB-001', type: 'informs', status: null, reviewNeeded: false },
        { from: 'FR-001', to: 'FB-001', type: 'justified_by', status: null, reviewNeeded: false },
      ],
    };

    const ids = toElements(graph).map((el) => el.data.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('returns an empty array for an empty subgraph', () => {
    expect(toElements({ nodes: [], edges: [] })).toEqual([]);
  });
});
