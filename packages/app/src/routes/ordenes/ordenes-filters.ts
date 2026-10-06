/**
 * Pure URL-parsing, server-query mapping and sort helpers for the Órdenes de trabajo table (SDD-013,
 * WO-360; SDD-064). Filtering, counting and paging happen server-side — kept free of React so the
 * mapping stays unit-testable on its own.
 */
import type { WorkOrderQueryFilter, WorkOrderSummary } from '@prdm/core';
import type { StatusBadgeWorkOrderStatus } from '../../components/index.js';
import { sortItems, type SortState } from '../../lib/filter-sort.js';

const KNOWN_WORK_ORDER_STATUSES: readonly StatusBadgeWorkOrderStatus[] = ['pending', 'in_progress', 'out_of_sync', 'done', 'archived'];

/** `WorkOrderSummary.status` is a bare `string` server-side; narrows it to `StatusBadge`'s own literal
 * union, falling back to `'pending'` for a status this UI doesn't know about yet rather than crashing. */
export function asWorkOrderStatus(status: string): StatusBadgeWorkOrderStatus {
  return (KNOWN_WORK_ORDER_STATUSES as readonly string[]).includes(status) ? (status as StatusBadgeWorkOrderStatus) : 'pending';
}

export type OrdenesStatusFilter = 'todas' | 'pending' | 'in_progress' | 'out_of_sync' | 'done' | 'archived';
export type OrdenesActorFilter = 'todos' | 'agentes' | 'developers' | 'sin-asignar' | 'mio';

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

/** Offered only when the session has a handle (the screen decides); kept out of `ORDENES_ACTOR_OPTIONS`. */
export const ORDENES_ACTOR_SELF_OPTION: OrdenesActorOption = { value: 'mio', label: 'Asignada a: mí' };
export const ORDENES_NO_HANDLE_HINT = 'Definí tu handle en Ajustes › Perfil';

export const ORDENES_PAGE_SIZE = 25;

const ACTOR_KIND_BY_FILTER: Partial<Record<OrdenesActorFilter, NonNullable<WorkOrderQueryFilter['actorKind']>>> = {
  agentes: 'agent',
  developers: 'dev',
  'sin-asignar': 'unassigned',
};

/** Unknown values fall back to the default so a hand-edited URL never breaks the screen. */
export function parseStatusFilter(value: string | null): OrdenesStatusFilter {
  return ORDENES_STATUS_OPTIONS.some((option) => option.value === value) ? (value as OrdenesStatusFilter) : 'todas';
}

export function parseActorFilter(value: string | null): OrdenesActorFilter {
  const known = [...ORDENES_ACTOR_OPTIONS, ORDENES_ACTOR_SELF_OPTION].some((option) => option.value === value);
  return known ? (value as OrdenesActorFilter) : 'todos';
}

export function parsePage(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

export interface OrdenesQueryState {
  readonly status: OrdenesStatusFilter;
  readonly blueprintId: string;
  readonly actor: OrdenesActorFilter;
  readonly query: string;
  readonly page: number;
  readonly handle: string | null;
}

/** Maps the screen's filter state to the server query (SDD-064): the server filters, counts and pages. */
export function toWorkOrderQuery(state: OrdenesQueryState): WorkOrderQueryFilter {
  const q = state.query.trim();
  return {
    limit: ORDENES_PAGE_SIZE,
    offset: (state.page - 1) * ORDENES_PAGE_SIZE,
    status: state.status !== 'todas' ? state.status : undefined,
    blueprint: state.blueprintId !== ORDENES_BLUEPRINT_ALL ? state.blueprintId : undefined,
    actorKind: ACTOR_KIND_BY_FILTER[state.actor],
    assignedTo: state.actor === 'mio' && state.handle !== null ? `dev:${state.handle}` : undefined,
    q: q !== '' ? q : undefined,
  };
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
