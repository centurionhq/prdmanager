/**
 * WO-705 (SDD-091 D5): the audit filter state and the URL are the same thing. The four filters the screen
 * offers — action, a date range and the person — live in the query string (`?accion=&desde=&hasta=&actor=`),
 * so reloading the page or sharing the link reproduces the same cut of the log.
 *
 * This module is the pure half of that: params ↔ state, with every value narrowed to what the server accepts.
 * A hand-edited URL (`?desde=ayer`, `?actor=ana`) falls back to "no filter" instead of turning the screen into
 * the error plate of a `400 invalid query`; React only glues it to `useSearchParams` in `AuditLogView`.
 */
import type { AuditLogParams } from '../../api/audit.js';

/** The filter as the screen holds it: empty string means «no filter», for all four. */
export interface AuditFilterState {
  readonly action: string;
  /** `YYYY-MM-DD`, the shape `<input type="date">` produces; the server reads it as the UTC day boundary. */
  readonly from: string;
  readonly to: string;
  /** An actor is the `tipo:id` pair the table's «Quién» column already shows (`user:u1`, `agent:claude`). */
  readonly actor: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilterState = { action: '', from: '', to: '', actor: '' };

/** The URL params: Spanish in the address bar, English on the wire (`toAuditQuery` translates). */
export const AUDIT_FILTER_PARAMS = {
  action: 'accion',
  from: 'desde',
  to: 'hasta',
  actor: 'actor',
} as const;

/** Ceilings the server enforces (`auditLogQuerySchema` in `packages/contracts/src/audit.ts`): anything longer is
 * cut here rather than answered with a `400`. */
export const AUDIT_ACTION_MAX_LENGTH = 120;
const ACTOR_TYPE_MAX_LENGTH = 40;
const ACTOR_ID_MAX_LENGTH = 200;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `<input type="date">` value, or `''`. Beyond the shape, the calendar is checked: `2026-02-31` would roll
 * over to March inside `Date`, so it is compared back against the string it came from and dropped.
 */
export function parseAuditDate(value: string | null | undefined): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10) === value ? value : '';
}

/** `{ type: 'user', id: 'u1' }` → `user:u1`, the pairing the server takes as `actorType` + `actorId`. */
export function formatActorValue(actor: { readonly type: string; readonly id: string }): string {
  return `${actor.type}:${actor.id}`;
}

/** The inverse of `formatActorValue`, split at the *first* colon so an id that carries one survives. `null`
 * when the value is not a pair the server would accept. */
export function parseActorValue(value: string | null | undefined): { type: string; id: string } | null {
  if (typeof value !== 'string') return null;
  const at = value.indexOf(':');
  if (at <= 0) return null;
  const type = value.slice(0, at);
  const id = value.slice(at + 1);
  if (id.length === 0 || type.length > ACTOR_TYPE_MAX_LENGTH || id.length > ACTOR_ID_MAX_LENGTH) return null;
  return { type, id };
}

function normalizeAction(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().slice(0, AUDIT_ACTION_MAX_LENGTH) : '';
}

function normalizeActor(value: string | null | undefined): string {
  const actor = parseActorValue(value);
  return actor === null ? '' : formatActorValue(actor);
}

/** The four filters a URL carries, with every invalid one dropped. Unknown params are ignored. */
export function parseAuditFilters(params: URLSearchParams): AuditFilterState {
  return {
    action: normalizeAction(params.get(AUDIT_FILTER_PARAMS.action)),
    from: parseAuditDate(params.get(AUDIT_FILTER_PARAMS.from)),
    to: parseAuditDate(params.get(AUDIT_FILTER_PARAMS.to)),
    actor: normalizeActor(params.get(AUDIT_FILTER_PARAMS.actor)),
  };
}

/**
 * The filter written back onto a copy of the current params: an empty or invalid filter deletes its param
 * instead of leaving `accion=` behind, and everything another screen put in the URL stays untouched.
 */
export function applyAuditFilters(previous: URLSearchParams, state: AuditFilterState): URLSearchParams {
  const next = new URLSearchParams(previous);
  const normalized = parseAuditFilters(
    new URLSearchParams({
      [AUDIT_FILTER_PARAMS.action]: state.action,
      [AUDIT_FILTER_PARAMS.from]: state.from,
      [AUDIT_FILTER_PARAMS.to]: state.to,
      [AUDIT_FILTER_PARAMS.actor]: state.actor,
    }),
  );
  for (const [field, key] of Object.entries(AUDIT_FILTER_PARAMS) as Array<[keyof AuditFilterState, string]>) {
    const value = normalized[field];
    if (value === '') next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/** The server query: `action`, `from`/`to` and the actor split back into `actorType` + `actorId`. Only the
 * filters that are set travel, so an unfiltered screen asks for exactly what it asked for before. */
export function toAuditQuery(state: AuditFilterState): AuditLogParams {
  const actor = parseActorValue(state.actor);
  return {
    action: state.action !== '' ? state.action : undefined,
    from: state.from !== '' ? state.from : undefined,
    to: state.to !== '' ? state.to : undefined,
    actorType: actor?.type,
    actorId: actor?.id,
  };
}

/** Whether anything is filtered at all: what «Quitar filtros» hangs on. */
export function hasAuditFilters(state: AuditFilterState): boolean {
  return state.action !== '' || state.from !== '' || state.to !== '' || state.actor !== '';
}
