/**
 * Shared fetch + parse for `packages/app`'s typed API client (SDD-006 §Dashboard shell: "cliente de API
 * tipado con contracts, CSRF y errores", WO-116). Mirrors `packages/web/src/client/api/request.ts`'s
 * shape (a single `request<T>()` every `client.ts` function goes through), extended for a
 * session-cookie + CSRF world instead of PRD-004's read-only, unauthenticated `GET`s:
 *
 * - every request carries `credentials: 'include'` (session and, once issued, CSRF cookies are httpOnly
 *   and same-origin — never read by this code, only sent back by the browser itself);
 * - every mutating (`POST`/`PUT`/`PATCH`/`DELETE`) request to `/api/app/*` first fetches a fresh
 *   `x-csrf-token` from `GET /api/app/csrf-token` (SDD-006 §Cabeceras: "issue token via a GET endpoint")
 *   and attaches it as a header — the server's own double-submit check (`registerCsrfEnforcement`)
 *   rejects a mutating `/api/app/*` request without one, session or not.
 *
 * `/api/auth/*` (better-auth) is deliberately routed through {@link authRequest} instead: it never sits
 * behind this CSRF check (only `/api/app/*` does — see `packages/server/src/csrf/register-csrf.ts`) and
 * its error bodies aren't the shared `{error:{code,message}}` envelope, but better-auth's own
 * `{message, code}` shape (confirmed against `better-call`'s `APIError` body, the library
 * `better-auth`'s own errors are built from).
 */
import { ApiClientError, type ApiErrorCode } from './api-client-error.js';

const CSRF_TOKEN_URL = '/api/app/csrf-token';
const CSRF_HEADER = 'x-csrf-token';
const APP_PREFIX = '/api/app';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface AppErrorBody {
  error: { code: string; message: string };
}

function isAppErrorBody(body: unknown): body is AppErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const { error } = body as { error: unknown };
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

/** The flat `{error: '<code>', message}` shape a few routes use instead of the nested envelope above —
 * see the doc comment on `FlatApiErrorCode` in `./api-client-error.ts`. Checked only after
 * {@link isAppErrorBody} rejects the body, since a nested `error` object would otherwise also satisfy
 * `typeof error !== 'string'` here and fall through correctly either way. */
function isFlatErrorBody(body: unknown): body is { error: string; message: string } {
  if (typeof body !== 'object' || body === null) return false;
  const { error, message } = body as { error?: unknown; message?: unknown };
  return typeof error === 'string' && typeof message === 'string';
}

interface AuthErrorBody {
  message: string;
  code?: string;
}

function isAuthErrorBody(body: unknown): body is AuthErrorBody {
  return typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string';
}

/** `undefined` for a `204`/empty body — every route in this contract always returns JSON, but an empty
 * response should fail as a malformed body rather than crash `JSON.parse` on an empty string. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text);
}

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch(CSRF_TOKEN_URL, { credentials: 'include', headers: { Accept: 'application/json' } });
  let body: unknown;
  try {
    body = await readJson(response);
  } catch {
    throw new ApiClientError(response.status, 'unknown', 'malformed CSRF token response');
  }
  const token = body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined;
  if (!response.ok || typeof token !== 'string') {
    throw new ApiClientError(response.status, 'unknown', 'failed to obtain a CSRF token');
  }
  return token;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

function isMutating(method: string): boolean {
  return MUTATING_METHODS.has(method);
}

/** Any ASCII control character (tab, newline, carriage return, ...) — the WHATWG URL parser (the same
 * algorithm every browser uses for `location.href`/`<a href>`) strips these from a URL before parsing it,
 * so `/\t/evil.com` and `/\n/evil.com` both resolve to `//evil.com` (protocol-relative, cross-origin) even
 * though neither literally starts with `//` as a JS string. */
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f]/;

/** Guards the `next=` redirect target below against an open redirect: only a same-origin, root-relative
 * path is safe. Rejects a protocol-relative path (`//evil.com`, parsed by browsers as same-scheme,
 * cross-origin), any path carrying its own scheme (`https://evil.com`, `javascript:...`), any path
 * containing a backslash (the same URL parser treats `\` as `/`, so `/\evil.com` also resolves to
 * `evil.com`), and any path carrying a stripped control character (see {@link CONTROL_CHAR_PATTERN}). */
function isSafeNextPath(path: string): boolean {
  if (CONTROL_CHAR_PATTERN.test(path)) return false;
  if (path.includes('\\')) return false;
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('://');
}

/** Exported for tests; every other caller reaches this only via {@link request}'s own 401 handling. */
export function buildLoginRedirectUrl(currentPath: string): string {
  return isSafeNextPath(currentPath) ? `/login?next=${encodeURIComponent(currentPath)}` : '/login';
}

/** SDD-013 §"Capa de datos": any `/api/app/*` call answered with 401 means the session is gone (expired,
 * signed out elsewhere) — bounce to `/login` with a `next=` back to the current route. No-op outside a
 * browser (e.g. this module's own Node-run unit tests never hit a 401 today, but stay defensive). */
function redirectToLogin(): void {
  if (typeof window === 'undefined' || !window.location) return;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.href = buildLoginRedirectUrl(currentPath);
}

/** Exported for `./agent.ts`'s streaming `fetch` call (WO-176), which can't go through {@link request}
 * itself since that always reads the *whole* body as JSON — an SSE response is read incrementally. */
export async function buildFetchInit(path: string, options: RequestOptions, includeCsrf: boolean): Promise<RequestInit> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let requestBody: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(options.body);
  }
  if (includeCsrf && isMutating(method) && path.startsWith(APP_PREFIX)) {
    headers[CSRF_HEADER] = await fetchCsrfToken();
  }
  return { method, headers, body: requestBody, credentials: 'include' };
}

/** Every `/api/app/*` call in `./client.ts` (session-authenticated or not — `GET /api/app/csrf-token`
 * and `POST /api/app/invitations/:id/accept` are both `public` server-side but still sit behind the same
 * CSRF hook) goes through this. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const init = await buildFetchInit(path, options, true);
  const response = await fetch(path, init);

  let body: unknown;
  try {
    body = await readJson(response);
  } catch {
    throw new ApiClientError(response.status, 'unknown', `malformed response body from ${path}`);
  }

  if (!response.ok) {
    if (response.status === 401) redirectToLogin();
    if (isAppErrorBody(body)) {
      throw new ApiClientError(response.status, body.error.code as ApiErrorCode, body.error.message);
    }
    if (isFlatErrorBody(body)) {
      throw new ApiClientError(response.status, body.error, body.message);
    }
    throw new ApiClientError(response.status, 'unknown', `request to ${path} failed with status ${response.status}`);
  }

  if (body === undefined) {
    throw new ApiClientError(response.status, 'unknown', `empty response body from ${path}`);
  }

  return body as T;
}

/** Every `/api/auth/*` (better-auth) call in `./auth.ts` goes through this instead of {@link request}: no
 * CSRF handshake (better-auth's allowlisted surface isn't behind that hook) and better-auth's own error
 * shape. A `twoFactorRedirect: true` body on an otherwise-2xx response is treated as success here — it's
 * a legitimate step in the sign-in flow, not an error — and left for the caller to branch on. */
export async function authRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const init = await buildFetchInit(path, options, false);
  const response = await fetch(path, init);

  let body: unknown;
  try {
    body = await readJson(response);
  } catch {
    throw new ApiClientError(response.status, 'unknown', `malformed response body from ${path}`);
  }

  if (!response.ok) {
    if (isAuthErrorBody(body)) {
      throw new ApiClientError(response.status, 'unknown', body.message);
    }
    throw new ApiClientError(response.status, 'unknown', `request to ${path} failed with status ${response.status}`);
  }

  if (body === undefined) {
    throw new ApiClientError(response.status, 'unknown', `empty response body from ${path}`);
  }

  return body as T;
}
