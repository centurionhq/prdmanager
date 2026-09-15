/**
 * `/collab`'s own `Origin` check (SDD-008 §"Servidor de tiempo real": "Origin obligatorio y exacto
 * contra PRDM_TRUSTED_ORIGINS (sin Origin o con null se rechaza)") — deliberately **not**
 * `../csrf/origin-check.js`'s `isTrustedRequestOrigin`, which allows `Sec-Fetch-Site: same-origin` to
 * bypass an exact `Origin` match for ordinary mutating HTTP requests. A browser always sends `Origin` on
 * a WebSocket upgrade handshake regardless of same-origin-ness (unlike a same-origin `fetch`, which may
 * omit it), so SDD-008 asks for a strict, single rule here: `Origin` must be present and match one of
 * `PRDM_TRUSTED_ORIGINS` exactly, with no same-origin exception.
 */
export function isTrustedCollabOrigin(origin: string | string[] | undefined, trustedOrigins: readonly string[]): boolean {
  const value = Array.isArray(origin) ? origin[0] : origin;
  if (!value) return false;
  return trustedOrigins.includes(value);
}
