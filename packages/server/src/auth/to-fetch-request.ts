/**
 * Bridges Fastify's request/reply objects to the `fetch` `Request`/`Response` pair better-auth's
 * `auth.handler` expects (SDD-006 §Autenticación, WO-093/WO-094).
 *
 * `toFetchRequest` deliberately builds the internal URL from `originUrl` (always `env.publicUrl`),
 * never from the inbound `Host` header — the WO-083 learning test confirms better-auth's own
 * `baseURL` already ignores request `Host` for anything it generates (e.g. reset links), and this
 * keeps the URL better-auth *parses* just as immune to a spoofed `Host`/`X-Forwarded-Host`.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export function toFetchRequest(req: FastifyRequest, originUrl: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const url = new URL(req.url, originUrl).toString();
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
  });
}

export async function sendFetchResponse(response: Response, reply: FastifyReply): Promise<void> {
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-length') reply.header(key, value);
  });
  reply.send(Buffer.from(await response.arrayBuffer()));
}
