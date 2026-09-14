/**
 * Learning test — ADR-006 / WO-084.
 *
 * Confirms the exact @modelcontextprotocol/sdk 1.30.0 API assumed by SDD-010 §"MCP remoto" for
 * mounting a stateless `StreamableHTTPServerTransport` inside Fastify: `POST /mcp/:graphProjectId`
 * with `sessionIdGenerator: undefined`, GET/DELETE answering 405, a per-request `McpServer` +
 * transport, and a real `StreamableHTTPClientTransport` client listing tools and calling one with a
 * Bearer header visible server-side.
 *
 * CONFIRMED (read from `node_modules/@modelcontextprotocol/sdk` 1.30.0 sources, then verified
 * empirically with a real Fastify server listening on an OS-assigned port):
 *
 *  - Import paths: `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`,
 *    `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`,
 *    `Client` from `@modelcontextprotocol/sdk/client/index.js`, `StreamableHTTPClientTransport`
 *    from `@modelcontextprotocol/sdk/client/streamableHttp.js` — matching what `packages/mcp`
 *    already imports for the stdio transport.
 *  - `StreamableHTTPServerTransport` (the Node-compatible wrapper the ADR names) is a thin shim over
 *    `WebStandardStreamableHTTPServerTransport` built with `@hono/node-server`'s `getRequestListener`
 *    (a transitive dependency of the SDK, confirmed present in `node_modules/@hono/node-server`).
 *    Its `handleRequest(req, res, parsedBody?)` writes the response directly onto the raw Node `res`
 *    it's given — it does not return a `Response` to forward. CONFIRMED Fastify integration point:
 *    the route MUST call `reply.hijack()` *before* `transport.handleRequest(req.raw, reply.raw,
 *    req.body)`, or Fastify's own reply lifecycle races the transport's direct writes to `res`.
 *  - `sessionIdGenerator: undefined` is exactly the stateless-mode switch (matches the ADR wording
 *    verbatim). CONFIRMED from the SDK's own source comment: "In stateless mode (no
 *    sessionIdGenerator), each request must use a fresh transport. Reusing a stateless transport
 *    causes message ID collisions between clients" — the SDK *throws* on reuse, so "per-request
 *    `McpServer` + transport" (SDD-010's design) isn't just a convenient choice, it's enforced by the
 *    library. This is exactly the pattern used by the SDK's own bundled reference example,
 *    `examples/server/simpleStatelessStreamableHttp.js`, confirmed by reading it: fresh
 *    `McpServer`/`transport` per POST, GET/DELETE routes that return 405 by hand (not delegated to
 *    the transport, which would otherwise try to open an SSE stream for GET).
 *  - GET/DELETE are NOT rejected by the transport itself in a way useful here — `handleRequest`
 *    happily dispatches GET to `handleGetRequest` (opening an SSE stream) and DELETE to
 *    `handleDeleteRequest`. The "GET and DELETE respond 405" requirement is therefore the route's
 *    own responsibility: separate Fastify `GET`/`DELETE` handlers on the same path that never call
 *    into the transport at all (confirmed below).
 *  - The `Authorization` header is visible in two places, both confirmed: directly on the Fastify
 *    request (`req.headers.authorization`, read *before* handing off to the transport, exactly where
 *    Bearer-token auth in SDD-010 would run) and, inside any tool handler, via the callback's
 *    `extra.requestInfo.headers.authorization` (`RequestHandlerExtra.requestInfo` is the original
 *    HTTP request, exposed by the SDK for exactly this purpose).
 *  - A real `StreamableHTTPClientTransport` (`requestInit: { headers: { authorization } }`) backing a
 *    `Client` can `listTools()` and `callTool()` against the mounted route end-to-end.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as z from 'zod';
import { afterEach, describe, expect, test } from 'vitest';

const METHOD_NOT_ALLOWED_BODY = { jsonrpc: '2.0' as const, error: { code: -32000, message: 'Method not allowed.' }, id: null };

/** One tool ("echo") that reports the Bearer header it saw, exactly like a real remote-MCP tool
 * would need to for auth (SDD-010 §"MCP remoto"). A fresh instance per request, per the header
 * comment above. */
function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'wo084-learning', version: '1.0.0' });
  server.registerTool(
    'echo',
    { description: 'Echoes the given text back, plus the Authorization header it saw', inputSchema: { text: z.string() } },
    async ({ text }, extra) => {
      const authorization = extra.requestInfo?.headers.authorization;
      return { content: [{ type: 'text' as const, text: `${text}:${authorization ?? 'no-auth'}` }] };
    },
  );
  return server;
}

/** Mounts `/mcp/:projectId` per SDD-010: stateless POST through the SDK, GET/DELETE hand-rolled 405. */
function buildApp(seenAuthorizationHeaders: string[]): FastifyInstance {
  const app = Fastify({ logger: false });

  app.post('/mcp/:projectId', async (req, reply) => {
    seenAuthorizationHeaders.push(req.headers.authorization ?? '');
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // CONFIRMED (see header comment): required before handing off, since `handleRequest` writes
    // directly to the raw Node response rather than returning one for Fastify to send itself.
    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
  });

  app.get('/mcp/:projectId', async (_req, reply) => {
    reply.code(405).send(METHOD_NOT_ALLOWED_BODY);
  });
  app.delete('/mcp/:projectId', async (_req, reply) => {
    reply.code(405).send(METHOD_NOT_ALLOWED_BODY);
  });

  return app;
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  return `http://127.0.0.1:${address.port}/mcp/proj-1`;
}

describe('MCP SDK 1.30.0 StreamableHTTPServerTransport, stateless, mounted in Fastify (ADR-006, WO-084)', () => {
  let app: FastifyInstance | undefined;
  const clients: Client[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) await client.close();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  test('GET returns 405 without ever reaching the transport', async () => {
    const seen: string[] = [];
    app = buildApp(seen);
    const baseUrl = await listen(app);

    const res = await fetch(baseUrl, { method: 'GET', headers: { accept: 'text/event-stream' } });

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual(METHOD_NOT_ALLOWED_BODY);
    expect(seen).toEqual([]);
  });

  test('DELETE returns 405 without ever reaching the transport', async () => {
    const seen: string[] = [];
    app = buildApp(seen);
    const baseUrl = await listen(app);

    const res = await fetch(baseUrl, { method: 'DELETE' });

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual(METHOD_NOT_ALLOWED_BODY);
    expect(seen).toEqual([]);
  });

  test('a StreamableHTTPClientTransport client lists tools and calls one over POST', async () => {
    const seen: string[] = [];
    app = buildApp(seen);
    const baseUrl = await listen(app);

    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { authorization: 'Bearer test-token-123' } },
    });
    const client = new Client({ name: 'wo084-learning-client', version: '1.0.0' });
    clients.push(client);
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(['echo']);

    const result = await client.callTool({ name: 'echo', arguments: { text: 'hello' } });
    expect(result.content).toEqual([{ type: 'text', text: 'hello:Bearer test-token-123' }]);
  });

  test('the Bearer header is visible on the Fastify request itself, before the transport runs', async () => {
    const seen: string[] = [];
    app = buildApp(seen);
    const baseUrl = await listen(app);

    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { authorization: 'Bearer route-visible-token' } },
    });
    const client = new Client({ name: 'wo084-learning-client', version: '1.0.0' });
    clients.push(client);
    await client.connect(transport);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === 'Bearer route-visible-token')).toBe(true);
  });
});
