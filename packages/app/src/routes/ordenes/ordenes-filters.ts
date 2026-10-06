/**
 * Pure filter/sort helpers for the Órdenes de trabajo table (SDD-013, WO-360). Combines the estado
 * chips, the blueprint/asignada-a selects and the free-text search with a logical AND — kept free of
 * React so the combinations stay unit-testable on their own, same convention as the Centurion Factory
 * design package's own `features/ordenes/filters.ts` this ports from mock data to `WorkOrderSummary`.
 */
import type { WorkOrderSummary } from '@prdm/core';
import type { StatusBadgeWorkOrderStatus } from '../../components/index.js';
import { searchItems, sortItems, type SortState } from '../../lib/filter-sort.js';

const KNOWN_WORK_ORDER_STATUSES: readonly StatusBadgeWorkOrderStatus[] = ['pending', 'in_progress', 'out_of_sync', 'done', 'archived'];

/** `WorkOrderSummary.status` is a bare `string` server-side; narrows it to `StatusBadge`'s own literal
 * union, falling back to `'pending'` for a status this UI doesn't know about yet rather than crashing. */
export function asWorkOrderStatus(status: string): StatusBadgeWorkOrderStatus {
  return (KNOWN_WORK_ORDER_STATUSES as readonly string[]).includes(status) ? (status as StatusBadgeWorkOrderStatus) : 'pending';
}

export type OrdenesStatusFilter = 'todas' | 'pending' | 'in_progress' | 'out_of_sync' | 'done' | 'archived';
export type OrdenesActorFilter = 'todos' | 'agentes' | 'developers' | 'sin-asignar';

export interface OrdenesStatusOption {
  readonly value: OrdenesStatusFilter;
  readonly label: string;
}

export const ORDENES_STATUS_OPTIONS: readonly OrdenesStatusOption[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'out_of_sync', label: 'Fuera de sincronía' },
  { value: 'done', label: 'Hechas' },
  { value: 'archived', label: 'Archivadas' },
];

export interface OrdenesActorOption {
  readonly value: OrdenesActorFilter;
  readonly label: string;
}

export const ORDENES_ACTOR_OPTIONS: readonly OrdenesActorOption[] = [
  { value: 'todos', label: 'Asignada a: todos' },
  { value: 'agentes', label: 'Asignada a: agentes' },
  { value: 'developers', label: 'Asignada a: developers' },
  { value: 'sin-asignar', label: 'Asignada a: sin asignar' },
];

export const ORDENES_BLUEPRINT_ALL = 'todos';

export interface OrdenesFilterState {
  readonly status: OrdenesStatusFilter;
  readonly blueprintId: string;
  readonly actor: OrdenesActorFilter;
  readonly query: string;
}

function matchesStatus(order: WorkOrderSummary, status: OrdenesStatusFilter): boolean {
  // "Todas" is the active queue: archived orders only show under their own chip (SDD-064 D3, FB-069).
  if (status === 'todas') return order.status !== 'archived';
  return order.status === status;
}

function matchesActor(order: WorkOrderSummary, actor: OrdenesActorFilter): boolean {
  if (actor === 'todos') return true;
  if (actor === 'sin-asignar') return !order.assignedTo;
  if (actor === 'agentes') return order.assignedTo?.startsWith('agent:') ?? false;
  return order.assignedTo?.startsWith('dev:') ?? false;
}

function matchesBlueprint(order: WorkOrderSummary, blueprintId: string): boolean {
  return blueprintId === ORDENES_BLUEPRINT_ALL || order.blueprints.includes(blueprintId);
}

function searchFields(order: WorkOrderSummary): readonly string[] {
  return [order.id, order.title, ...order.blueprints, order.assignedTo ?? ''];
}

/** Every filter except `status`: reused for both the visible rows and each chip's own count. */
function matchesEverythingButStatus(order: WorkOrderSummary, filters: OrdenesFilterState): boolean {
  return matchesBlueprint(order, filters.blueprintId) && matchesActor(order, filters.actor);
}

/** Rows visible for the current combination of chip, selects and search. */
export function filterWorkOrders(orders: readonly WorkOrderSummary[], filters: OrdenesFilterState): WorkOrderSummary[] {
  const withoutSearch = orders.filter((order) => matchesEverythingButStatus(order, filters) && matchesStatus(order, filters.status));
  return searchItems(withoutSearch, filters.query, searchFields);
}

/** How many orders each estado chip would show given the other active filters. */
export function statusCounts(orders: readonly WorkOrderSummary[], filters: OrdenesFilterState): Record<OrdenesStatusFilter, number> {
  const base = searchItems(orders.filter((order) => matchesEverythingButStatus(order, filters)), filters.query, searchFields);
  const counts = {} as Record<OrdenesStatusFilter, number>;
  for (const option of ORDENES_STATUS_OPTIONS) {
    counts[option.value] = base.filter((order) => matchesStatus(order, option.value)).length;
  }
  return counts;
}

export function uniqueBlueprintIds(orders: readonly WorkOrderSummary[]): string[] {
  return Array.from(new Set(orders.flatMap((order) => order.blueprints))).sort((a, b) => a.localeCompare(b, 'es'));
}

export type OrdenesSortKey = 'id' | 'title' | 'blueprint' | 'status' | 'assignedTo';

export const ORDENES_DEFAULT_SORT: SortState<OrdenesSortKey> = { key: 'id', direction: 'asc' };

export const ORDENES_SORT_ACCESSORS: Record<OrdenesSortKey, (order: WorkOrderSummary) => string> = {
  id: (order) => order.id,
  title: (order) => order.title,
  blueprint: (order) => order.blueprints[0] ?? '',
  status: (order) => order.status,
  assignedTo: (order) => order.assignedTo ?? '',
};

export function sortWorkOrders(orders: readonly WorkOrderSummary[], sort: SortState<OrdenesSortKey>): WorkOrderSummary[] {
  return sortItems(orders, ORDENES_SORT_ACCESSORS[sort.key], sort.direction);
}
