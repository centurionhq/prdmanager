/**
 * Pure filtering helpers for the Órdenes de trabajo table (WO-291): the status chips, the
 * Blueprint and Asignada a selects, and the free-text search all combine with a logical AND.
 * Kept free of React so the predicate combinations are unit-testable on their own.
 */
import { searchItems, type SortState } from '../../lib/filter-sort';
import type { ActorRef, WorkOrder, WorkOrderStatus } from '../../data';
import { CURRENT_HANDLE, devActor } from './actions';

/**
 * The demo's logged-in user (see the Ana Ríos profile card in the sidebar), derived from the
 * session handle so "Tomadas por mí" and the «Yo» of "Tomar orden" can never disagree. No mock work
 * order is assigned to her, so "Tomadas por mí" is naturally empty here — the same behavior
 * canvas/Ordenes.dc.html hardcodes for its approved `mine` filter.
 */
export const CURRENT_ACTOR: ActorRef | null = CURRENT_HANDLE === null ? null : devActor(CURRENT_HANDLE);

export type StatusFilterKey = 'todas' | WorkOrderStatus | 'mias';

export interface StatusFilterOption {
  readonly key: StatusFilterKey;
  readonly label: string;
}

export const STATUS_FILTERS: readonly StatusFilterOption[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'in_progress', label: 'En curso' },
  { key: 'out_of_sync', label: 'Fuera de sincronía' },
  { key: 'done', label: 'Hechas' },
  { key: 'archived', label: 'Archivadas' },
  { key: 'mias', label: 'Tomadas por mí' },
];

export type AssigneeFilterKey = 'todas' | 'agentes' | 'developers' | 'sin-asignar';

export interface AssigneeFilterOption {
  readonly value: AssigneeFilterKey;
  readonly label: string;
}

export const ASSIGNEE_FILTERS: readonly AssigneeFilterOption[] = [
  { value: 'todas', label: 'Asignada a: todas' },
  { value: 'agentes', label: 'Asignada a: agentes' },
  { value: 'developers', label: 'Asignada a: developers' },
  { value: 'sin-asignar', label: 'Asignada a: sin asignar' },
];

export const DEFAULT_BLUEPRINT_FILTER = 'todos';

const STATUS_FILTER_KEYS: ReadonlySet<string> = new Set(STATUS_FILTERS.map((option) => option.key));

/** Validates `?filtro=` against the known chip keys, falling back to "todas" for anything else. */
export function parseStatusFilter(value: string | null): StatusFilterKey {
  if (value && STATUS_FILTER_KEYS.has(value)) return value as StatusFilterKey;
  return 'todas';
}

function matchesStatus(order: WorkOrder, key: StatusFilterKey): boolean {
  // "Todas" is the active queue: archived orders only show under their own chip (SDD-064, FB-069).
  if (key === 'todas') return order.status !== 'archived';
  if (key === 'mias') return CURRENT_ACTOR !== null && order.assignedTo === CURRENT_ACTOR;
  return order.status === key;
}

/** How many orders are in `status` overall, ignoring every other filter — the footer's "de M". */
export function statusTotal(orders: readonly WorkOrder[], status: StatusFilterKey): number {
  return orders.filter((order) => matchesStatus(order, status)).length;
}

function matchesAssignee(order: WorkOrder, key: AssigneeFilterKey): boolean {
  if (key === 'todas') return true;
  if (key === 'sin-asignar') return !order.assignedTo;
  if (key === 'agentes') return order.assignedTo?.startsWith('agent:') ?? false;
  return order.assignedTo?.startsWith('dev:') ?? false;
}

export interface OrdenesFilters {
  readonly status: StatusFilterKey;
  readonly blueprintId: string;
  readonly assignee: AssigneeFilterKey;
  readonly featureId?: string;
  readonly query: string;
}

/** Every filter except `status`: used both for the visible rows and for each chip's own count. */
function matchesEverythingButStatus(order: WorkOrder, filters: OrdenesFilters): boolean {
  if (filters.blueprintId !== DEFAULT_BLUEPRINT_FILTER && order.blueprintId !== filters.blueprintId) return false;
  if (filters.featureId && order.featureId !== filters.featureId) return false;
  if (!matchesAssignee(order, filters.assignee)) return false;
  return true;
}

/** Rows visible for the current combination of chip, selects and search. */
export function filterWorkOrders(orders: readonly WorkOrder[], filters: OrdenesFilters): WorkOrder[] {
  const withoutSearch = orders.filter((order) => matchesEverythingButStatus(order, filters) && matchesStatus(order, filters.status));
  return searchItems(withoutSearch, filters.query, (order) => [order.id, order.title, order.blueprintId, order.assignedTo ?? '']);
}

/** How many orders each chip would show given the other active filters (blueprint/assignee/search). */
export function statusCounts(orders: readonly WorkOrder[], filters: OrdenesFilters): Record<StatusFilterKey, number> {
  const base = searchItems(
    orders.filter((order) => matchesEverythingButStatus(order, filters)),
    filters.query,
    (order) => [order.id, order.title, order.blueprintId, order.assignedTo ?? ''],
  );
  const counts = {} as Record<StatusFilterKey, number>;
  for (const option of STATUS_FILTERS) {
    counts[option.key] = base.filter((order) => matchesStatus(order, option.key)).length;
  }
  return counts;
}

export type OrdenesSortKey = 'id' | 'title' | 'blueprintId' | 'status' | 'assignedTo' | 'updatedAt';

export const DEFAULT_SORT: SortState<OrdenesSortKey> = { key: 'updatedAt', direction: 'desc' };
