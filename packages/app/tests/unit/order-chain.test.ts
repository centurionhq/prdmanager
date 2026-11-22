import type { Subgraph, SubgraphEdge, SubgraphNode } from '@prdm/core';
import { describe, expect, it } from 'vitest';
import { chainSummary, orderChainRows } from '../../src/routes/arbol/order-chain.js';

/**
 * WO-747 (SDD-104 D1/D6) + WO-789 (SDD-120 D2/D4/D10): la cadena SDD-rama de una feature, medida sobre el
 * subgrafo del branch que la pantalla ya consulta -- sin endpoint nuevo. Por cada orden: los blueprints de
 * sus aristas `IMPLEMENTS` (WO→blueprint) y el commit de sus aristas `RESOLVES` (commit→WO).
 *
 * Desde SDD-120 D1 (`SUBGRAPH_PROJECTION` en `packages/core/src/graph/queries.ts`) cada nodo `Commit` trae
 * `date` y `sha` completos, así que el desempate puede ser **el del CLI**: `date DESC, sha DESC` con las
 * fechas nulas al final, la misma regla que `LIST_WORK_ORDERS` → `landedCommitSha` (D2).
 */

function node(ref: string, label: string, title = ref, status: string | null = null): SubgraphNode {
  return { ref, label, kind: null, title, status };
}

/** Un nodo `Commit` como lo publica la proyección desde D1: `sha` de 40 hex y `date` ISO-8601. */
function commitNode(ref: string, sha: string | null, date: string | null): SubgraphNode {
  return { ref, label: 'Commit', kind: null, title: ref, status: null, sha, date };
}

function edge(from: string, to: string, type: string): SubgraphEdge {
  return { from, to, type, status: null, reviewNeeded: false };
}

/** Los dos commits reales de WO-727: `d6f4139…` (sha más alto) es 32 s más viejo que `8dd1c5c3…`. */
const WO_727_D6F = 'd6f4139d818a1b2c3d4e5f60718293a4b5c6d7e8';
const WO_727_8DD = '8dd1c5c3b58a58a89c10129b505bad8428e8bf3d';

/** Un branch como el que devuelve `get_feature_branch` para FR-040 (medido en vivo el 22/11). */
const BRANCH: Subgraph = {
  nodes: [node('SDD-104', 'Blueprint', 'La cadena SDD-rama en el panel del Árbol'), node('WO-747', 'WorkOrder', 'WO-A (app)', 'pending'), node('WO-748', 'WorkOrder', 'WO-B (gate)', 'pending'), node('commit:15e5683', 'Commit', 'feat: la cadena (WO-747)', null)],
  edges: [edge('WO-747', 'SDD-104', 'IMPLEMENTS'), edge('WO-748', 'SDD-104', 'IMPLEMENTS'), edge('commit:15e5683', 'WO-747', 'RESOLVES')],
};

describe('orderChainRows', () => {
  it('toma el SDD de la arista IMPLEMENTS y el sha de la arista RESOLVES (D1)', () => {
    const rows = orderChainRows(BRANCH);

    expect(rows.map((row) => row.ref)).toEqual(['WO-747', 'WO-748']);
    expect(rows[0]).toMatchObject({ ref: 'WO-747', title: 'WO-A (app)', status: 'pending', sdds: ['SDD-104'], landedSha: '15e5683', commitCount: 1 });
  });

  it('una orden sin arista RESOLVES queda sin commit, no con un sha inventado (D3)', () => {
    const rows = orderChainRows(BRANCH);

    expect(rows[1]).toMatchObject({ ref: 'WO-748', landedSha: null, landedAt: null, commitCount: 0 });
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

  /**
   * SDD-120 D2, el hecho que originó el WO: en FR-017 la fila WO-727 mostraba `d6f4139` (el sha más alto)
   * mientras `list_work_orders` publicaba `landedCommitSha 8dd1c5c3…` (el más reciente). El panel tiene que
   * elegir como el CLI, no por sha.
   */
  it('con varios commits elige el de fecha más reciente, no el sha más alto (D2, el caso WO-727)', () => {
    const subgraph: Subgraph = {
      nodes: [
        node('WO-727', 'WorkOrder', 'Rework', 'done'),
        commitNode('commit:d6f4139', WO_727_D6F, '2026-11-22T14:11:20.000Z'),
        commitNode('commit:8dd1c5c', WO_727_8DD, '2026-11-22T14:11:52.000Z'),
      ],
      edges: [edge('commit:d6f4139', 'WO-727', 'RESOLVES'), edge('commit:8dd1c5c', 'WO-727', 'RESOLVES')],
    };

    const row = orderChainRows(subgraph)[0];

    // `d6f4139…` > `8dd1c5c3…` como string, pero es el más viejo: gana el de 14:11:52.
    expect(row?.landedSha).toBe(WO_727_8DD);
    expect(row?.landedAt).toBe('2026-11-22T14:11:52.000Z');
    expect(row?.commitCount).toBe(2);
  });

  it('a igualdad de fecha desempata el sha más alto, el `c.sha DESC` de LIST_WORK_ORDERS (D2)', () => {
    const sameDate = '2026-11-22T14:11:52.000Z';
    const subgraph: Subgraph = {
      nodes: [
        node('WO-727', 'WorkOrder', 'Rework', 'done'),
        commitNode('commit:8dd1c5c', WO_727_8DD, sameDate),
        commitNode('commit:d6f4139', WO_727_D6F, sameDate),
      ],
      edges: [edge('commit:8dd1c5c', 'WO-727', 'RESOLVES'), edge('commit:d6f4139', 'WO-727', 'RESOLVES')],
    };

    expect(orderChainRows(subgraph)[0]?.landedSha).toBe(WO_727_D6F);
  });

  it('las fechas nulas van al final: un commit fechado gana aunque su sha sea el más bajo (D2)', () => {
    const subgraph: Subgraph = {
      nodes: [
        node('WO-727', 'WorkOrder', 'Rework', 'done'),
        commitNode('commit:8dd1c5c', WO_727_8DD, '2026-11-22T14:11:52.000Z'),
        commitNode('commit:fffffff', 'f'.repeat(40), null),
      ],
      edges: [edge('commit:8dd1c5c', 'WO-727', 'RESOLVES'), edge('commit:fffffff', 'WO-727', 'RESOLVES')],
    };

    expect(orderChainRows(subgraph)[0]?.landedSha).toBe(WO_727_8DD);
  });

  it('sin fecha en ningún commit el orden sigue siendo determinista: sha más alto (D2)', () => {
    const subgraph: Subgraph = {
      nodes: [
        node('WO-727', 'WorkOrder', 'Rework', 'done'),
        commitNode('commit:aaa1111', 'a'.repeat(40), null),
        commitNode('commit:bbb2222', 'b'.repeat(40), null),
      ],
      edges: [edge('commit:aaa1111', 'WO-727', 'RESOLVES'), edge('commit:bbb2222', 'WO-727', 'RESOLVES')],
    };

    expect(orderChainRows(subgraph)[0]?.landedSha).toBe('b'.repeat(40));
  });

  it('el sha canónico son los 40 hex de la proyección, no los 7 del ref (D10)', () => {
    const subgraph: Subgraph = {
      nodes: [node('WO-727', 'WorkOrder', 'Rework', 'done'), commitNode('commit:8dd1c5c', WO_727_8DD, '2026-11-22T14:11:52.000Z')],
      edges: [edge('commit:8dd1c5c', 'WO-727', 'RESOLVES')],
    };

    const row = orderChainRows(subgraph)[0];

    expect(row?.landedSha).toBe(WO_727_8DD);
    expect(row?.landedSha).toHaveLength(40);
  });

  it('si la proyección no publicara `sha`, cae al `commit:<7>` del ref sin romper el contrato (D10-bis)', () => {
    const subgraph: Subgraph = {
      nodes: [node('WO-727', 'WorkOrder', 'Rework', 'done'), { ...node('commit:8dd1c5c', 'Commit'), sha: null, date: '2026-11-22T14:11:52.000Z' }],
      edges: [edge('commit:8dd1c5c', 'WO-727', 'RESOLVES')],
    };

    expect(orderChainRows(subgraph)[0]).toMatchObject({ landedSha: '8dd1c5c', commitCount: 1 });
  });

  it('toma la fecha del commit canónico del payload; sin fecha, null (nunca una fecha inventada)', () => {
    const withDate = {
      nodes: [node('WO-747', 'WorkOrder', 'Con fecha', 'pending'), { ...node('commit:bbb2222', 'Commit'), date: '2026-11-22T05:00:00.000Z' }],
      edges: [edge('commit:bbb2222', 'WO-747', 'RESOLVES')],
    } as unknown as Subgraph;

    expect(orderChainRows(withDate)[0]?.landedAt).toBe('2026-11-22T05:00:00.000Z');
    expect(orderChainRows(BRANCH)[0]?.landedAt).toBeNull();
  });

  it('cuenta los commits que resuelven la orden, no los nodos del branch (D10/D4)', () => {
    const subgraph: Subgraph = {
      nodes: [
        node('WO-727', 'WorkOrder', 'Rework', 'done'),
        node('WO-728', 'WorkOrder', 'Sin commit', 'pending'),
        commitNode('commit:d6f4139', WO_727_D6F, '2026-11-22T14:11:20.000Z'),
        commitNode('commit:8dd1c5c', WO_727_8DD, '2026-11-22T14:11:52.000Z'),
      ],
      edges: [edge('commit:d6f4139', 'WO-727', 'RESOLVES'), edge('commit:8dd1c5c', 'WO-727', 'RESOLVES')],
    };

    expect(orderChainRows(subgraph).map((row) => row.commitCount)).toEqual([2, 0]);
  });

  it('no lee los commits de otra orden: cada fila sólo cuenta sus aristas RESOLVES', () => {
    const subgraph: Subgraph = {
      nodes: [
        node('WO-727', 'WorkOrder', 'Con commit', 'done'),
        node('WO-728', 'WorkOrder', 'Con el mismo commit', 'done'),
        commitNode('commit:8dd1c5c', WO_727_8DD, '2026-11-22T14:11:52.000Z'),
      ],
      edges: [edge('commit:8dd1c5c', 'WO-727', 'RESOLVES'), edge('commit:8dd1c5c', 'WO-728', 'RESOLVES')],
    };

    expect(orderChainRows(subgraph).map((row) => [row.ref, row.landedSha, row.commitCount])).toEqual([
      ['WO-727', WO_727_8DD, 1],
      ['WO-728', WO_727_8DD, 1],
    ]);
  });

  it('un branch sin datos devuelve una lista vacía, no un error', () => {
    expect(orderChainRows(null)).toEqual([]);
    expect(orderChainRows({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe('chainSummary', () => {
  const rows = [
    { ref: 'WO-1', title: '', status: 'pending', sdds: [], landedSha: 'aaa1111', landedAt: null, commitCount: 1 },
    { ref: 'WO-2', title: '', status: 'pending', sdds: [], landedSha: null, landedAt: null, commitCount: 0 },
    { ref: 'WO-3', title: '', status: 'in_progress', sdds: [], landedSha: 'bbb2222', landedAt: null, commitCount: 1 },
    { ref: 'WO-4', title: '', status: 'out_of_sync', sdds: [], landedSha: null, landedAt: null, commitCount: 0 },
    // Una orden ya hecha no está pendiente: no entra ni en el numerador ni en el denominador (D5).
    { ref: 'WO-5', title: '', status: 'done', sdds: [], landedSha: 'ccc3333', landedAt: null, commitCount: 3 },
  ];

  it('cuenta las pendientes y cuántas de ellas ya tienen commit (D5)', () => {
    expect(chainSummary(rows)).toEqual({ pending: 4, landed: 2 });
  });

  it('sin órdenes pendientes el resumen es cero de cero, no un error', () => {
    expect(chainSummary([])).toEqual({ pending: 0, landed: 0 });
    expect(chainSummary(rows.filter((row) => row.status === 'done'))).toEqual({ pending: 0, landed: 0 });
  });
});

