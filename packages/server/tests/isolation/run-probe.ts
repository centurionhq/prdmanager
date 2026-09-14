/**
 * Executes one {@link RouteProbeCase} against a real, running server (SDD-006 §Aislamiento por capas
 * point 4, WO-111): fills the route's `:param` placeholders, attaches the right credential (session
 * cookie or Bearer header), completes the CSRF handshake for mutating requests, and returns the raw
 * response for the caller to assert 404 + no-canary against.
 */
import { ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, mutationHeaders } from './fixtures.js';
import type { BuiltApp, RouteProbeCase } from './types.js';

/** Every method `packages/server` actually registers a route with — narrower than Fastify's own
 * `HTTPMethods` (which also lists `COPY`/`PROPFIND`/etc, methods `light-my-request`'s `inject()` type
 * doesn't accept), so a route table entry for a method outside this list is a type error, not a
 * runtime surprise. */
export type IsolationHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Fastify's own `:name` path param syntax — the same pattern every route in `packages/server/src/api`
 * uses, substituted with `encodeURIComponent` so a fixture id/slug is always used literally. */
function fillPathParams(pathTemplate: string, values: Record<string, string> = {}): string {
  return pathTemplate.replace(/:([A-Za-z0-9_]+)/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`isolation probe: missing path param value for "${name}" in ${pathTemplate}`);
    return encodeURIComponent(value);
  });
}

function toQueryString(query: Record<string, string> | undefined): string {
  const entries = Object.entries(query ?? {});
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

export interface ProbeResponse {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
}

export async function runIsolationProbe(
  app: BuiltApp,
  method: IsolationHttpMethod,
  pathTemplate: string,
  mutating: boolean,
  probe: RouteProbeCase,
): Promise<ProbeResponse> {
  const url = fillPathParams(pathTemplate, probe.params.path) + toQueryString(probe.params.query);

  const headers: Record<string, string> = { ...ISOLATION_AUTH_HOST };
  if (probe.credential.kind === 'bearer') {
    headers.authorization = `Bearer ${probe.credential.secret}`;
  } else if (mutating) {
    Object.assign(headers, await mutationHeaders(app, ISOLATION_AUTH_HOST, ISOLATION_ORIGIN, probe.credential.cookie));
  } else {
    headers.cookie = probe.credential.cookie;
  }

  const res = await app.inject({ method, url, headers, payload: probe.params.body });
  return { statusCode: res.statusCode, body: res.body, headers: res.headers as Record<string, unknown> };
}

/** SDD-006 §Aislamiento point 4: "un texto canario de A nunca aparezca" — checked in the body and in
 * every header value (a leak through `location`/an audit-derived header would be just as real a bug as
 * one in the JSON body). */
export function assertNoCanaryLeak(response: ProbeResponse, canary: string): void {
  if (response.body.includes(canary)) {
    throw new Error(`isolation probe: canary "${canary}" leaked into the response body: ${response.body}`);
  }
  for (const [name, value] of Object.entries(response.headers)) {
    if (typeof value === 'string' && value.includes(canary)) {
      throw new Error(`isolation probe: canary "${canary}" leaked into response header "${name}": ${value}`);
    }
  }
}
