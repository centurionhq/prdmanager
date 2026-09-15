/**
 * Per-token rate limit for the remote MCP endpoint (SDD-010 "MCP remoto", WO-184: "rate limit por
 * token, contando cada tool de un batch JSON-RPC"). Same `@fastify/rate-limit` mechanism as
 * `./agent-rate-limits.ts` (`app.createRateLimit`, `WeakMap<FastifyRequest, string>` keying since
 * `keyGenerator` only ever receives the request), but `check` is meant to be called **once per tool
 * call**, not once per HTTP request — a single `POST /mcp/:graphProjectId` carrying a batched JSON-RPC
 * array of 50 tool calls must count as 50 hits against this same token's budget, which is exactly what
 * calling `check` from inside the per-tool wrapper (`./mcp-remote.js`) achieves.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

const ONE_MINUTE_MS = 60_000;

export interface McpToolRateLimiter {
  check(req: FastifyRequest, tokenId: string): Promise<boolean>;
}

function isExceeded(result: { isExceeded?: boolean; [key: string]: unknown }): boolean {
  return result.isExceeded === true;
}

const tokenKeyByRequest = new WeakMap<FastifyRequest, string>();

/** Requires `@fastify/rate-limit` to already be registered on `app` (see `build-server.ts`). */
export function buildMcpToolRateLimiter(app: FastifyInstance, maxToolCallsPerMinute: number): McpToolRateLimiter {
  const perToken = app.createRateLimit({
    max: maxToolCallsPerMinute,
    timeWindow: ONE_MINUTE_MS,
    keyGenerator: (req) => `mcp-tool:${tokenKeyByRequest.get(req) ?? ''}`,
  });

  return {
    async check(req, tokenId) {
      tokenKeyByRequest.set(req, tokenId);
      try {
        const result = await perToken(req);
        return !isExceeded(result);
      } finally {
        tokenKeyByRequest.delete(req);
      }
    },
  };
}
