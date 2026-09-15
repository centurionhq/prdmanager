/**
 * Pure `Origin`/`Sec-Fetch-Site` check (SDD-006 §Cabeceras, CSRF y logs, WO-108): defense in depth on
 * top of the CSRF double-submit token itself — a token that leaked into a cross-site page (e.g. via an
 * XSS on a *different* trusted origin, or a browser bug) still shouldn't be honored from a request the
 * browser itself is telling us didn't originate same-origin.
 *
 * SDD-006: "chequeo de Origin/Sec-Fetch-Site en toda ruta mutante ... rechazar cross-site; permitir
 * same-origin y ausencia de Sec-Fetch-Site solo cuando el Origin coincide con PRDM_TRUSTED_ORIGINS":
 * - `Sec-Fetch-Site: same-origin` → allowed outright (the browser itself vouches for this).
 * - `Sec-Fetch-Site` absent (older browsers, or non-fetch/non-XHR clients that never send it) → allowed
 *   only when `Origin` is present and exactly matches one of `PRDM_TRUSTED_ORIGINS`.
 * - anything else (`cross-site`, `same-site`, `none`, or an unrecognized value) → rejected.
 */
export interface OriginCheckHeaders {
  origin?: string | string[] | undefined;
  'sec-fetch-site'?: string | string[] | undefined;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isTrustedRequestOrigin(headers: OriginCheckHeaders, trustedOrigins: readonly string[]): boolean {
  const secFetchSite = firstHeaderValue(headers['sec-fetch-site'])?.toLowerCase();
  const origin = firstHeaderValue(headers.origin);

  if (secFetchSite === 'same-origin') return true;
  if (secFetchSite === undefined) return origin !== undefined && trustedOrigins.includes(origin);
  return false;
}
