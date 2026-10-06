const MS_PER_DAY = 86_400_000;

/**
 * Días completos transcurridos desde `createdAt` (SDD-075 D1), calculados al leer y nunca persistidos.
 * Una fecha sin hora (`YYYY-MM-DD`, el formato de `created_at`) parsea como medianoche UTC (ISO 8601) y el
 * cálculo cuenta períodos de 24 h completos, no días calendario. Sin fecha o con fecha inválida devuelve
 * `null`; una fecha futura devuelve `0`.
 */
export function ageDaysFrom(createdAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!createdAt) return null;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return null;
  const elapsed = now.getTime() - created;
  return elapsed <= 0 ? 0 : Math.floor(elapsed / MS_PER_DAY);
}
