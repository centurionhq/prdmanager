/**
 * Injects the per-request CSP style nonce (`./security-headers.ts`'s `req.cspNonce`) into `packages/app`'s
 * static `index.html` shell (SDD-006 §Cabeceras / SDD-008 §"Editor": "nonce de CSP" for CodeMirror's own
 * injected `<style>` elements). `index.html` is a plain built static file — there is no per-request
 * templating anywhere else in this SPA's serving path — so a fixed placeholder `<meta>` tag is the only
 * thing this module ever rewrites, by an exact string replace (the nonce is `randomBytes(16).toString
 * ('base64')`, an alphabet with no `<`/`>`/`"` to escape).
 *
 * Deliberately a no-op (returns `html` unchanged) when the placeholder isn't present — a test fixture's
 * throwaway `index.html` (`tests/unit/static-serving.test.ts`) has no `<head>` at all, and a real build
 * missing the placeholder for any reason must still serve *something* rather than 500.
 */
const CSP_NONCE_PLACEHOLDER = '<meta name="csp-nonce" content="" />';

export function injectCspNonce(html: string, nonce: string): string {
  if (!html.includes(CSP_NONCE_PLACEHOLDER)) return html;
  return html.replace(CSP_NONCE_PLACEHOLDER, `<meta name="csp-nonce" content="${nonce}" />`);
}
