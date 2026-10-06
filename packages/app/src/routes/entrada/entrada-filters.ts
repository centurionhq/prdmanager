/**
 * Pure, React-free filter/sort/group/pagination engine for the Entrada inbox (SDD-065 WO-B, D2/D4/D6).
 *
 * Kept out of the screen — like `drift/drift-groups.ts` — so the edge cases the URL can carry
 * (unknown `estado`/`tipo`, a page past the end, an all-automatic inbox, accents in the query) are
 * unit-testable without rendering. The URL is the single source of truth (D4): `parseEntradaQuery`
 * reads it and `toEntradaSearchParams` writes it back, both falling back to the defaults below.
 */
import type { InboxItemDto } from '@prdm/contracts';
import { normalize, sortItems, type SortState } from '../../lib/filter-sort.js';

export type EntradaEstado = 'todos' | 'new' | 'triaged' | 'dismissed' | 'closed';
export type EntradaTipo = 'todos' | 'FB' | 'ART';
/** Every sortable column the `DataTable` exposes; `receivedAt` is the default (D2). */
export type EntradaSortKey = 'receivedAt' | 'id' | 'title' | 'source' | 'status';
export type SortDirection = 'asc' | 'desc';

export const ENTRADA_PAGE_SIZE = 25;
export const ALL_SOURCES = '';
export const ALL_ESTADOS: EntradaEstado = 'todos';
export const ALL_TIPOS: EntradaTipo = 'todos';
export const AUTOMATIC_SOURCE_PREFIX = 'agent:';

const ESTADOS: readonly EntradaEstado[] = ['todos', 'new', 'triaged', 'dismissed', 'closed'];
const TIPOS: readonly EntradaTipo[] = ['todos', 'FB', 'ART'];
const SORT_KEYS: readonly EntradaSortKey[] = ['receivedAt', 'id', 'title', 'source', 'status'];
const DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

/** The whole screen state, mirrored 1:1 in the URL query string (D4). */
export interface EntradaQuery {
  readonly estado: EntradaEstado;
  readonly tipo: EntradaTipo;
  readonly fuente: string;
  readonly q: string;
  readonly sort: EntradaSortKey;
  readonly dir: SortDirection;
  readonly page: number;
}

export const DEFAULT_ENTRADA_QUERY: EntradaQuery = {
  estado: ALL_ESTADOS,
  tipo: ALL_TIPOS,
  fuente: ALL_SOURCES,
  q: '',
  sort: 'receivedAt',
  dir: 'desc',
  page: 1,
};

/** Newest first is the whole point of "ver primero lo importante" (D2); everything else starts asc. */
export function defaultDirection(sort: EntradaSortKey): SortDirection {
  return sort === 'receivedAt' ? 'desc' : 'asc';
}

function pickOne<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  if (value !== null && (allowed as readonly string[]).includes(value)) return value as T;
  return fallback;
}

function parsePage(value: string | null): number {
  if (value === null) return DEFAULT_ENTRADA_QUERY.page;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_ENTRADA_QUERY.page;
}

/** Reads the URL, mapping every unknown/absent value onto its default (D4: "valores inválidos caen al default"). */
export function parseEntradaQuery(params: URLSearchParams): EntradaQuery {
  const sort = pickOne(params.get('sort'), SORT_KEYS, DEFAULT_ENTRADA_QUERY.sort);
  return {
    estado: pickOne(params.get('estado'), ESTADOS, ALL_ESTADOS),
    tipo: pickOne(params.get('tipo'), TIPOS, ALL_TIPOS),
    fuente: params.get('fuente')?.trim() ?? ALL_SOURCES,
    q: params.get('q') ?? '',
    sort,
    dir: pickOne(params.get('dir'), DIRECTIONS, defaultDirection(sort)),
    page: parsePage(params.get('pagina')),
  };
}

/**
 * Serializes the state back into the URL, omitting anything at its default so a pristine screen keeps a
 * clean query string. `sort`'s own default direction depends on the key, so `dir` is only written when
 * it differs from {@link defaultDirection}.
 */
export function toEntradaSearchParams(query: EntradaQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.estado !== DEFAULT_ENTRADA_QUERY.estado) params.set('estado', query.estado);
  if (query.tipo !== DEFAULT_ENTRADA_QUERY.tipo) params.set('tipo', query.tipo);
  if (query.fuente !== DEFAULT_ENTRADA_QUERY.fuente) params.set('fuente', query.fuente);
  if (query.q.trim() !== '') params.set('q', query.q.trim());
  if (query.sort !== DEFAULT_ENTRADA_QUERY.sort) params.set('sort', query.sort);
  if (query.dir !== defaultDirection(query.sort)) params.set('dir', query.dir);
  if (query.page > 1) params.set('pagina', String(query.page));
  return params;
}

/** Items whose `source` is an assistant (`agent:*`) — the ones D6 folds into a collapsible block. */
export function isAutomatic(item: InboxItemDto): boolean {
  return item.source.startsWith(AUTOMATIC_SOURCE_PREFIX);
}

function matchesQuery(item: InboxItemDto, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const values = [item.id, item.title, item.body].map(normalize);
  return terms.every((term) => values.some((value) => value.includes(term)));
}

/**
 * Keeps the items satisfying every active filter (logical AND): estado, tipo, fuente and a
 * whitespace-separated, accent- and case-insensitive query over id, título and cuerpo.
 */
export function filterInbox(items: readonly InboxItemDto[], query: EntradaQuery): InboxItemDto[] {
  const terms = normalize(query.q).split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (query.estado === ALL_ESTADOS || item.status === query.estado) &&
      (query.tipo === ALL_TIPOS || item.kind === query.tipo) &&
      (query.fuente === ALL_SOURCES || item.source === query.fuente) &&
      matchesQuery(item, terms),
  );
}

const SORT_VALUE: Readonly<Record<EntradaSortKey, (item: InboxItemDto) => string>> = {
  receivedAt: (item) => item.receivedAt,
  id: (item) => item.id,
  title: (item) => item.title,
  source: (item) => item.source,
  status: (item) => item.status,
};

/** Stable, non-mutating sort by the chosen column (D2). `receivedAt` sorts on the ISO string. */
export function sortInbox(items: readonly InboxItemDto[], sort: SortState<EntradaSortKey>): InboxItemDto[] {
  return sortItems(items, SORT_VALUE[sort.key], sort.direction);
}

export interface EntradaPage<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
}

export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamps a page into `[1, pageCount]`; an out-of-range page shows the last one instead of nothing. */
export function clampPage(page: number, total: number, pageSize: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), pageCountFor(total, pageSize));
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number = ENTRADA_PAGE_SIZE): EntradaPage<T> {
  const total = items.length;
  const pageCount = pageCountFor(total, pageSize);
  const safePage = clampPage(page, total, pageSize);
  const start = (safePage - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: safePage, pageCount, total };
}

export interface EntradaList {
  /** The human items, paginated: what the main table renders. */
  readonly manual: EntradaPage<InboxItemDto>;
  /** Every `agent:*` item matching the current filters, for the collapsible block at the end (D6). */
  readonly automatic: readonly InboxItemDto[];
}

/**
 * The one pipeline the screen runs: filter → sort → split automáticos → paginate the human rows (D6
 * keeps the automatic block outside the pagination, with its own count).
 */
export function buildEntradaList(
  items: readonly InboxItemDto[],
  query: EntradaQuery,
  pageSize: number = ENTRADA_PAGE_SIZE,
): EntradaList {
  const sorted = sortInbox(filterInbox(items, query), { key: query.sort, direction: query.dir });
  const automatic = sorted.filter(isAutomatic);
  const manual = sorted.filter((item) => !isAutomatic(item));
  return { manual: paginate(manual, query.page, pageSize), automatic };
}

/** Distinct sources present, sorted, for the "Fuente" select. */
export function inboxSources(items: readonly InboxItemDto[]): string[] {
  return Array.from(new Set(items.map((item) => item.source))).sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * `DD/MM/YYYY` straight from the ISO string's date part, with no `Date`/locale involved so the same
 * input renders identically in every environment (tests included). An unrecognized value passes through.
 */
export function formatReceivedDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Human label of an inbox item's `status` (SDD-065 D7, `closed` per SDD-092 D7); unknown values pass through. */
export function statusLabel(status: string): string {
  if (status === 'new') return 'Sin triar';
  if (status === 'triaged') return 'Triado';
  if (status === 'dismissed') return 'Descartado';
  if (status === 'duplicate') return 'Duplicado';
  if (status === 'closed') return 'Cerrado';
  return status;
}
