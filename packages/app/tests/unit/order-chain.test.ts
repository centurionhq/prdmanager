import type { Subgraph, SubgraphEdge, SubgraphNode } from '@prdm/core';
import { describe, expect, it } from 'vitest';
import { chainSummary, orderChainRows } from '../../src/routes/arbol/order-chain.js';

/**
 * WO-747 (SDD-104 D1/D6): la cadena SDD-rama de una feature, medida sobre el subgrafo del branch que la
 * pantalla ya consulta -- sin endpoint nuevo. Por cada orden: los blueprints de sus aristas `IMPLEMENTS`
 * (WO→blueprint) y el commit de su arista `RESOLVES` (commit→WO). El payload del branch **no** publica la
 * fecha del commit (`SUBGRAPH_PROJECTION` en `packages/core/src/graph/queries.ts` sólo devuelve
 * `ref/label/kind/title/status`), así que `landedAt` queda `null` hoy: el helper lo expone igual para que el
 * día que la proyección lo publique no haya que cambiar el consumidor.
 */

function node(ref: string, label: string, title = ref, status: string | null = null): SubgraphNode {
  return { ref, label, kind: null, title, status };
}

function edge(from: string, to: string, type: string): SubgraphEdge {
  return { from, to, type, status: null, reviewNeeded: false };
}

/** Un branch como el que devuelve `get_feature_branch` para FR-040 (medido en vivo el 22/11). */
const BRANCH: Subgraph = {
  nodes: [node('SDD-104', 'Blueprint', 'La cadena SDD-rama en el panel del Árbol'), node('WO-747', 'WorkOrder', 'WO-A (app)', 'pending'), node('WO-748', 'WorkOrder', 'WO-B (gate)', 'pending'), node('commit:15e5683', 'Commit', 'feat: la cadena (WO-747)', null)],
  edges: [edge('WO-747', 'SDD-104', 'IMPLEMENTS'), edge('WO-748', 'SDD-104', 'IMPLEMENTS'), edge('commit:15e5683', 'WO-747', 'RESOLVES')],
};

describe('orderChainRows', () => {
  it('toma el SDD de la arista IMPLEMENTS y el sha de la arista RESOLVES (D1)', () => {
    const rows = orderChainRows(BRANCH);

    expect(rows.map((row) => row.ref)).toEqual(['WO-747', 'WO-748']);
    expect(rows[0]).toMatchObject({ ref: 'WO-747', title: 'WO-A (app)', status: 'pending', sdds: ['SDD-104'], landedSha: '15e5683' });
  });

  it('una orden sin arista RESOLVES queda sin commit, no con un sha inventado (D3)', () => {
    const rows = orderChainRows(BRANCH);

    expect(rows[1]).toMatchObject({ ref: 'WO-748', landedSha: null, landedAt: null });
    // El SDD sí está: lo que falta es el commit, no la cadena entera.
    expect(rows[1]?.sdds).toEqual(['SDD-104']);
  });

  it('muestra todos los blueprints de una orden, sin repetirlos y en orden (D2)', () => {
    const subgraph: Subgraph = {
      nodes: [node('WO-747', 'WorkOrder', 'Dos blueprints', 'pending'), node('SDD-104', 'Blueprint'), node('ADR-030', 'Blueprint')],
      edges: [edge('WO-747', 'SDD-104', 'IMPLEMENTS'), edge('WO-747', 'ADR-030', 'IMPLEMENTS'), edge('WO-747', 'SDD-104', 'IMPLEMENTS')],
    };

    expect(orderChainRows(subgraph)[0]?.sdds).toEqual(['ADR-030', 'SDD-104']);
  });

  it('no deriva el SDD del prefijo del id de la orden: sin arista IMPLEMENTS no hay SDD', () => {
    const subgraph: Subgraph = {
      nodes: [node('WO-747', 'WorkOrder', 'Sin arista', 'pending')],
      edges: [],
    };

    expect(orderChainRows(subgraph)[0]?.sdds).toEqual([]);
  });

  it('ignora los nodos que no son órdenes y las aristas que no son de la cadena', () => {
    const subgraph: Subgraph = {
      nodes: [node('SDD-104', 'Blueprint'), node('WO-747', 'WorkOrder', 'Orden', 'pending'), node('FB-323', 'Feedback'), node('code:packages/app/src/routes/ProjectGraph.tsx', 'CodeRef')],
      edges: [edge('WO-747', 'SDD-104', 'IMPLEMENTS'), edge('FB-323', 'SDD-104', 'JUSTIFIED_BY'), edge('code:packages/app/src/routes/ProjectGraph.tsx', 'SDD-104', 'GOVERNED_BY')],
    };

    const rows = orderChainRows(subgraph);

    expect(rows.map((row) => row.ref)).toEqual(['WO-747']);
    expect(rows[0]?.sdds).toEqual(['SDD-104']);
  });

  it('con varios commits elige el sha más alto, el mismo desempate que usa el server (LIST_WORK_ORDERS)', () => {
    const subgraph: Subgraph = {
      nodes: [node('WO-747', 'WorkOrder', 'Rework', 'pending'), node('commit:aaa1111', 'Commit'), node('commit:bbb2222', 'Commit')],
      // El payload no trae la fecha, así que el orden por fecha del server no se puede reproducir: queda su
      // desempate (`c.sha DESC`), para que el resultado sea determinista.
      edges: [edge('commit:aaa1111', 'WO-747', 'RESOLVES'), edge('commit:bbb2222', 'WO-747', 'RESOLVES')],
    };

    expect(orderChainRows(subgraph)[0]?.landedSha).toBe('bbb2222');
  });

  it('toma la fecha del commit sólo si el payload la trae (hoy la proyección no la publica)', () => {
    const withDate = {
      nodes: [node('WO-747', 'WorkOrder', 'Con fecha', 'pending'), { ...node('commit:bbb2222', 'Commit'), date: '2026-11-22T05:00:00.000Z' }],
      edges: [edge('commit:bbb2222', 'WO-747', 'RESOLVES')],
    } as unknown as Subgraph;

    expect(orderChainRows(withDate)[0]?.landedAt).toBe('2026-11-22T05:00:00.000Z');
    // Y sin la fecha en el payload, null: nunca una fecha inventada.
    expect(orderChainRows(BRANCH)[0]?.landedAt).toBeNull();
  });

  it('un branch sin datos devuelve una lista vacía, no un error', () => {
    expect(orderChainRows(null)).toEqual([]);
    expect(orderChainRows({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe('chainSummary', () => {
  const rows = [
    { ref: 'WO-1', title: '', status: 'pending', sdds: [], landedSha: 'aaa1111', landedAt: null },
    { ref: 'WO-2', title: '', status: 'pending', sdds: [], landedSha: null, landedAt: null },
    { ref: 'WO-3', title: '', status: 'in_progress', sdds: [], landedSha: 'bbb2222', landedAt: null },
    { ref: 'WO-4', title: '', status: 'out_of_sync', sdds: [], landedSha: null, landedAt: null },
    // Una orden ya hecha no está pendiente: no entra ni en el numerador ni en el denominador (D5).
    { ref: 'WO-5', title: '', status: 'done', sdds: [], landedSha: 'ccc3333', landedAt: null },
  ];

  it('cuenta las pendientes y cuántas de ellas ya tienen commit (D5)', () => {
    expect(chainSummary(rows)).toEqual({ pending: 4, landed: 2 });
  });

  it('sin órdenes pendientes el resumen es cero de cero, no un error', () => {
    expect(chainSummary([])).toEqual({ pending: 0, landed: 0 });
    expect(chainSummary(rows.filter((row) => row.status === 'done'))).toEqual({ pending: 0, landed: 0 });
  });
});
