/**
 * Small pure formatting helpers for the Documento screen (WO-287), kept local to this feature so
 * it never reaches into src/features/documentos or src/lib.
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "hace N min" / "hace N h", used in the meta line under the document title. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMs = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (diffMs < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(diffMs / MINUTE_MS));
    return `hace ${minutes} min`;
  }
  const hours = Math.floor(diffMs / HOUR_MS);
  return `hace ${hours} h`;
}
