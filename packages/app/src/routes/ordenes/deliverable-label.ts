/**
 * Copy and defensive narrowing of a work order's deliverable class (SDD-093 D7/D8): «Código» closes with a
 * commit `Refs: WO-xxx`, «Gate» closes with evidence via `archive_work_order` + motive. Pure, no React.
 *
 * Front and back deploy apart and the client does not validate responses at runtime, so a missing or
 * unknown `deliverableKind` (an older server) falls back to `code` — today's behavior: «Completar» offered
 * and the archive motive optional.
 */
import type { DeliverableKind } from '@prdm/core';

export type DeliverableCloseRoute = 'commit' | 'evidence';

export interface DeliverableCopy {
  readonly kind: DeliverableKind;
  readonly label: string;
  /** Lower-case on purpose: it reads as a continuation of the label. */
  readonly legend: string;
  readonly closesWith: DeliverableCloseRoute;
}

export const DELIVERABLE_FALLBACK_KIND: DeliverableKind = 'code';

export const DELIVERABLE_COPY: Record<DeliverableKind, DeliverableCopy> = {
  code: { kind: 'code', label: 'Código', legend: 'se cierra con un commit `Refs: WO-xxx`', closesWith: 'commit' },
  gate: { kind: 'gate', label: 'Gate', legend: 'se cierra con evidencia (`archive_work_order` + motivo)', closesWith: 'evidence' },
};

/** Legend order. */
export const DELIVERABLE_COPY_LIST: readonly DeliverableCopy[] = [DELIVERABLE_COPY.code, DELIVERABLE_COPY.gate];

/** A server that predates the field sends nothing; an unknown value falls back to the default. */
export function asDeliverableKind(value: unknown): DeliverableKind {
  return value === 'gate' || value === 'code' ? value : DELIVERABLE_FALLBACK_KIND;
}

export function deliverableCopy(value: unknown): DeliverableCopy {
  return DELIVERABLE_COPY[asDeliverableKind(value)];
}
