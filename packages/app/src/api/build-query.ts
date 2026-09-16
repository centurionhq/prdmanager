/** Shared `?key=value&...` builder for a `GET` endpoint's optional filters: a key whose value is
 * `undefined` (an omitted filter, not an empty string) is left out entirely. */
export function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const qs = query.toString();
  return qs.length > 0 ? `?${qs}` : '';
}
