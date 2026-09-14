import type { EdgeDefinition, NodeDefinition } from 'cytoscape';
import type { Subgraph } from '@prdm/core';

function toNodeElement(node: Subgraph['nodes'][number]): NodeDefinition {
  return {
    group: 'nodes',
    data: {
      id: node.ref,
      label: node.label,
      kind: node.kind,
      title: node.title,
      status: node.status,
    },
  };
}

function toEdgeElement(edge: Subgraph['edges'][number]): EdgeDefinition {
  return {
    group: 'edges',
    data: {
      id: `${edge.from}-${edge.type}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      type: edge.type,
      status: edge.status,
      reviewNeeded: edge.reviewNeeded,
    },
  };
}

/**
 * `Subgraph -> cytoscape.ElementDefinition[]` (SDD-005 "Frontend" `graph/to-elements.ts`), pure and side-effect
 * free so it can be unit tested without a `cy` instance. Edge ids are `${from}-${type}-${to}`: a single node pair
 * can be linked by more than one relationship type (e.g. `implements` and `justified_by`), so `type` has to be
 * part of the id to keep edges distinct.
 */
export function toElements(graph: Subgraph): (NodeDefinition | EdgeDefinition)[] {
  return [...graph.nodes.map(toNodeElement), ...graph.edges.map(toEdgeElement)];
}
