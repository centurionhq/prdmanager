/**
 * WO-747 (SDD-104 D1/D2/D5/D6): la cadena SDD-rama de una feature, medida sobre el subgrafo del branch que el
 * panel del Árbol ya consulta (`getFeatureBranch`) — sin endpoint nuevo, sin tocar `queryWorkOrders` y sin
 * requests extra. Por cada orden del branch:
 *
 * - `sdds`: los blueprints de sus aristas `IMPLEMENTS` (WO→blueprint). Si implementa más de uno se muestran
 *   todos: elegir uno en silencio sería inventar el dato (D2).
 * - `landedSha`: el commit de su arista `RESOLVES` (commit→WO), que es lo que el grafo indexa con el trailer
 *   `Refs: WO-xxx`. Sin arista no hay commit: `null`, nunca un guion mudo (D3).
 * - `landedAt`: la fecha del commit **si el payload la trae**. Hoy no la trae: `SUBGRAPH_PROJECTION`
 *   (`packages/core/src/graph/queries.ts`) publica sólo `ref/label/kind/title/status`. Se expone igual para
 *   que el día que la proyección la publique el consumidor no cambie.
 *
 * Vive acá y no dentro de `ProjectGraph.tsx` porque ese archivo es el hotspot de la pantalla y porque el
 * contrato se testea sin montar React (D6).
 */
import type { Subgraph, SubgraphEdge, SubgraphNode } from '@prdm/core';

export interface OrderChainRow {
  readonly ref: string;
  readonly title: string;
  readonly status: string | null;
  readonly sdds: readonly string[];
  readonly landedSha: string | null;
  readonly landedAt: string | null;
}

export interface ChainSummary {
  /** Órdenes del branch que todavía no se cerraron: `pending`, `in_progress` o `out_of_sync` (D5). */
  readonly pending: number;
  /** De esas pendientes, cuántas ya tienen commit aterrizado (D5). */
  readonly landed: number;
}

/** Los estados que D5 cuenta como «pendientes»; `done` y `archived` quedan afuera del resumen. */
const PENDING_STATUSES = new Set<string>(['pending', 'in_progress', 'out_of_sync']);

/** El nodo Commit del grafo se indexa como `commit:<7 primeros del sha>` (`MERGE_COMMITS`). */
const COMMIT_REF_PREFIX = 'commit:';

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

/** El sha que publica el ref del nodo Commit, o `null` si el ref llegara vacío. */
function shaOfCommitRef(ref: string): string | null {
  const sha = ref.startsWith(COMMIT_REF_PREFIX) ? ref.slice(COMMIT_REF_PREFIX.length) : ref;
  return sha.trim() === '' ? null : sha;
}

/** La fecha del commit, sólo si el payload la publica: `SUBGRAPH_PROJECTION` hoy no lo hace. */
function landedAtOf(node: SubgraphNode | undefined): string | null {
  const date = (node as { date?: unknown } | undefined)?.date;
  return typeof date === 'string' && date.trim() !== '' ? date : null;
}

/** Por orden: sus blueprints (`IMPLEMENTS`) y sus commits (`RESOLVES`), en un solo recorrido de aristas. */
function indexChainEdges(edges: readonly SubgraphEdge[]): { readonly sdds: Map<string, string[]>; readonly commits: Map<string, string[]> } {
  const sdds = new Map<string, string[]>();
  const commits = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'IMPLEMENTS') pushTo(sdds, edge.from, edge.to);
    else if (edge.type === 'RESOLVES') pushTo(commits, edge.to, edge.from);
  }
  return { sdds, commits };
}

/**
 * Una fila por orden del branch, en el orden del subgrafo (el panel decide cómo ordenarlas). Con varios
 * commits para la misma orden gana el sha más alto: es el desempate que ya usa `LIST_WORK_ORDERS`
 * (`ORDER BY c.date DESC, c.sha DESC`) y, sin fecha en el payload, lo único que mantiene el resultado
 * determinista.
 */
export function orderChainRows(subgraph: Subgraph | null): readonly OrderChainRow[] {
  if (!subgraph) return [];
  const nodesByRef = new Map(subgraph.nodes.map((node) => [node.ref, node] as const));
  const { sdds: sddsByOrder, commits: commitsByOrder } = indexChainEdges(subgraph.edges);

  return subgraph.nodes
    .filter((node) => node.label === 'WorkOrder')
    .map((node) => {
      const commitRefs = [...(commitsByOrder.get(node.ref) ?? [])]
        .map((ref) => ({ ref, sha: shaOfCommitRef(ref) }))
        .filter((commit): commit is { readonly ref: string; readonly sha: string } => commit.sha !== null)
        .sort((left, right) => right.sha.localeCompare(left.sha));
      const landed = commitRefs[0] ?? null;

      return {
        ref: node.ref,
        title: node.title,
        status: node.status,
        sdds: [...new Set(sddsByOrder.get(node.ref) ?? [])].sort((left, right) => left.localeCompare(right)),
        landedSha: landed?.sha ?? null,
        landedAt: landed ? landedAtOf(nodesByRef.get(landed.ref)) : null,
      };
    });
}

/** «N de M órdenes pendientes ya tienen commit» (D5): M las pendientes, N las que ya tienen commit. */
export function chainSummary(rows: readonly OrderChainRow[]): ChainSummary {
  const pending = rows.filter((row) => row.status !== null && PENDING_STATUSES.has(row.status));
  return { pending: pending.length, landed: pending.filter((row) => row.landedSha !== null).length };
}
