/**
 * WO-747 (SDD-104 D1/D2/D5/D6) + WO-789 (SDD-120 D2/D4/D10): la cadena SDD-rama de una feature, medida sobre
 * el subgrafo del branch que el panel del Árbol ya consulta (`getFeatureBranch`) — sin endpoint nuevo, sin
 * tocar `queryWorkOrders` y sin requests extra. Por cada orden del branch:
 *
 * - `sdds`: los blueprints de sus aristas `IMPLEMENTS` (WO→blueprint). Si implementa más de uno se muestran
 *   todos: elegir uno en silencio sería inventar el dato (D2).
 * - `landedSha` / `landedAt`: el commit canónico de sus aristas `RESOLVES` (commit→WO), que es lo que el grafo
 *   indexa con el trailer `Refs: WO-xxx`. Con varios commits gana el más reciente y, a igualdad de fecha, el
 *   sha más alto — `date DESC, sha DESC` con las fechas nulas al final, exactamente el `ORDER BY` de
 *   `LIST_WORK_ORDERS` en `packages/core/src/graph/queries.ts`, así el panel y el MCP/CLI no divergen (D2).
 *   `landedSha` son los 40 hex que publica la proyección desde SDD-120 D1; si vinieran nulos cae al `<7>` del
 *   ref (`commit:<7 hex>`) sin romper el contrato (D10/D10-bis). Sin arista no hay commit: `null`, nunca un
 *   guion mudo (SDD-104 D3).
 * - `commitCount`: cuántos commits resuelven la orden — la celda declara «· N commits» y con eso se sabe que
 *   el sha mostrado es uno de varios (D4).
 *
 * Vive acá y no dentro de `ProjectGraph.tsx` porque ese archivo es el hotspot de la pantalla y porque el
 * contrato se testea sin montar React (SDD-104 D6).
 */
import type { Subgraph, SubgraphEdge, SubgraphNode } from '@prdm/core';

export interface OrderChainRow {
  readonly ref: string;
  readonly title: string;
  readonly status: string | null;
  readonly sdds: readonly string[];
  /** El sha completo (40 hex) del commit canónico; `null` si la orden todavía no tiene commit. */
  readonly landedSha: string | null;
  /** La fecha ISO-8601 de ese commit; `null` sólo si el payload no la publica o la orden no tiene commit. */
  readonly landedAt: string | null;
  /** Cuántos commits `RESOLVES` resuelven esta orden: 0 sin commit, N con varios. */
  readonly commitCount: number;
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

/**
 * El sha del commit: el completo que publica la proyección (SDD-120 D1) y, sólo si viniera nulo o en blanco,
 * el corto del ref — un server viejo no puede dejar la celda sin identificador (D10-bis).
 */
function fullShaOf(node: SubgraphNode | undefined, ref: string): string | null {
  const sha = node?.sha;
  if (typeof sha === 'string' && sha.trim() !== '') return sha;
  return shaOfCommitRef(ref);
}

/** La fecha del commit en milisegundos, o `null` cuando falta o no es parseable. */
function commitTime(date: string | null): number | null {
  if (date === null) return null;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? null : parsed;
}

interface CommitCandidate {
  readonly sha: string;
  readonly date: string | null;
}

/**
 * `date DESC, sha DESC`, fechas nulas al final: el desempate de `LIST_WORK_ORDERS` (`ORDER BY c.date DESC,
 * c.sha DESC LIMIT 1`), que es el que define `landedCommitSha`. Sin fecha en ninguno de los dos, el sha
 * mantiene el resultado determinista (D2).
 */
function byCanonicalCommit(left: CommitCandidate, right: CommitCandidate): number {
  const leftTime = commitTime(left.date);
  const rightTime = commitTime(right.date);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return rightTime - leftTime;
  // Con fecha gana al que no la tiene: los nulos van al final.
  if (leftTime !== null && rightTime === null) return -1;
  if (leftTime === null && rightTime !== null) return 1;
  return right.sha.localeCompare(left.sha);
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
 * commits para la misma orden gana el más reciente por `date`, y a igualdad de fecha el sha más alto — la
 * regla de `LIST_WORK_ORDERS` (D2), con las fechas nulas al final.
 */
export function orderChainRows(subgraph: Subgraph | null): readonly OrderChainRow[] {
  if (!subgraph) return [];
  const nodesByRef = new Map(subgraph.nodes.map((node) => [node.ref, node] as const));
  const { sdds: sddsByOrder, commits: commitsByOrder } = indexChainEdges(subgraph.edges);

  return subgraph.nodes
    .filter((node) => node.label === 'WorkOrder')
    .map((node) => {
      const commits = (commitsByOrder.get(node.ref) ?? [])
        .map((ref) => {
          const commitNode = nodesByRef.get(ref);
          const date = typeof commitNode?.date === 'string' && commitNode.date.trim() !== '' ? commitNode.date : null;
          return { ref, sha: fullShaOf(commitNode, ref), date };
        })
        .filter((commit): commit is { readonly ref: string; readonly sha: string; readonly date: string | null } => commit.sha !== null)
        .sort(byCanonicalCommit);
      const landed = commits[0] ?? null;

      return {
        ref: node.ref,
        title: node.title,
        status: node.status,
        sdds: [...new Set(sddsByOrder.get(node.ref) ?? [])].sort((left, right) => left.localeCompare(right)),
        landedSha: landed?.sha ?? null,
        landedAt: landed?.date ?? null,
        commitCount: commits.length,
      };
    });
}

/** «N de M órdenes pendientes ya tienen commit» (D5): M las pendientes, N las que ya tienen commit. */
export function chainSummary(rows: readonly OrderChainRow[]): ChainSummary {
  const pending = rows.filter((row) => row.status !== null && PENDING_STATUSES.has(row.status));
  return { pending: pending.length, landed: pending.filter((row) => row.landedSha !== null).length };
}
