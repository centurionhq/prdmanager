/**
 * Test-only CSRF handshake helper (WO-108): every mutating `/api/app/*` request now needs both the
 * double-submit cookie (set by `GET /api/app/csrf-token`) and the matching `x-csrf-token` header, plus
 * an `Origin`/`Sec-Fetch-Site` pair the server accepts as same-origin — real integration tests exercise
 * the real hook, so they get this from here rather than bypassing it.
 */
import type { buildServer } from '../../src/build-server.js';

export interface CsrfHandshake {
  /** Merge into every mutating request's `headers` alongside any session cookie. */
  headers: {
    cookie: string;
    'x-csrf-token': string;
    origin: string;
  };
}

/** `origin` must be one of the server's `PRDM_TRUSTED_ORIGINS` (`buildTestServerEnv()`'s `publicUrl` by
 * default) for the request to pass the Origin/Sec-Fetch-Site check. */
export async function csrfHandshake(app: ReturnType<typeof buildServer>, host: { host: string }, origin: string): Promise<CsrfHandshake> {
  const res = await app.inject({ method: 'GET', url: '/api/app/csrf-token', headers: { ...host, origin } });
  const setCookie = res.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;
  const { token } = res.json() as { token: string };
  return { headers: { cookie, 'x-csrf-token': token, origin } };
}

/** Merges a session cookie with a fresh CSRF handshake's cookie (both are needed on the same request:
 * the session cookie for `requireAppSession`, the CSRF cookie for the double-submit check). */
export function mergeCookies(...cookies: string[]): string {
  return cookies.join('; ');
}

/** The full header set a mutating `/api/app/*` `app.inject` call needs: `host` + `origin` (same-origin,
 * per `env.publicUrl`), a fresh CSRF cookie/token pair, and — if the route also requires a session — that
 * session's cookie merged in alongside the CSRF one. */
export async function mutationHeaders(
  app: ReturnType<typeof buildServer>,
  host: { host: string },
  origin: string,
  sessionCookie?: string,
): Promise<{ host: string; origin: string; cookie: string; 'x-csrf-token': string }> {
  const csrf = await csrfHandshake(app, host, origin);
  return {
    ...host,
    origin,
    cookie: sessionCookie ? mergeCookies(sessionCookie, csrf.headers.cookie) : csrf.headers.cookie,
    'x-csrf-token': csrf.headers['x-csrf-token'],
  };
}
