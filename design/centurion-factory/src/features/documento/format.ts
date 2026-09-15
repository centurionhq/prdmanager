/**
 * Small pure formatting helpers for the Documento screen (WO-287), kept local to this feature so
 * it never reaches into src/features/documentos or src/lib beyond the shared date primitives.
 */
import { formatRelativeHoursOnly } from '../../lib/format-date';

/** "hace N min" / "hace N h", used in the meta line under the document title. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  return formatRelativeHoursOnly(iso, { now });
}
