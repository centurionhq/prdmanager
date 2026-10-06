import { classifyDbTimeout } from '@prdm/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PrdmDeps } from './deps.js';
import { ensureRecovered } from './recover.js';

export function jsonText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Pretty-printed JSON as text content plus the same data as structuredContent (natural for object-shaped results). */
export function jsonResult(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: jsonText(data) }], structuredContent: data };
}

export function textOnlyResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

function explicitError(data: { error: string; message: string }): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

/** Never leaks stack traces: only Error#message (or String(err)) is sent to the client. */
export function errorResult(err: unknown): CallToolResult {
  const dbTimeout = classifyDbTimeout(err);
  if (dbTimeout === 'busy') {
    return explicitError({ error: 'database_busy', message: 'database busy: no pooled connection became available in time, retry shortly' });
  }
  if (dbTimeout === 'statement') {
    return explicitError({ error: 'statement_timeout', message: 'statement timed out: the database did not answer within the statement timeout' });
  }
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Shared error boundary for every tool handler: converts thrown domain errors into a deterministic isError result. */
export function safeTool<Args, Extra>(
  fn: (args: Args, extra: Extra) => Promise<CallToolResult>,
): (args: Args, extra: Extra) => Promise<CallToolResult> {
  return async (args, extra) => {
    try {
      return await fn(args, extra);
    } catch (err) {
      return errorResult(err);
    }
  };
}

/**
 * Same error boundary as {@link safeTool}, plus `ensureRecovered(deps)` first (SDD-002 "Transacción atómica"):
 * every read tool must recover any pending journal/stale-graph marker before serving data, exactly like a write
 * does inside `engine.transaction()`.
 */
export function safeReadTool<Args, Extra>(
  deps: PrdmDeps,
  fn: (args: Args, extra: Extra) => Promise<CallToolResult>,
): (args: Args, extra: Extra) => Promise<CallToolResult> {
  return safeTool(async (args, extra) => {
    await ensureRecovered(deps);
    return fn(args, extra);
  });
}

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
export const WRITE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;
export const DESTRUCTIVE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: true, idempotentHint: true } as const;
export const WRITE_ONCE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
