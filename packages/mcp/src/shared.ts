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

export interface ByteCappedResultOptions<T extends Record<string, unknown>> {
  /** Hard ceiling, in bytes, of the envelope the client sees (the serialized `CallToolResult`). */
  maxBytes: number;
  /** Rows the page in `data` carries; the helper only ever asks for smaller pages. */
  pageSize: number;
  /** Rebuilds the envelope with at most `size` rows (1 <= size <= pageSize), honest about itself. */
  build: (size: number) => T;
}

/**
 * SDD-082 D4/D8: measures `Buffer.byteLength(JSON.stringify(jsonResult(data)), 'utf8')` (the body the transport
 * carries, `structuredContent` included). If it exceeds `maxBytes`, bisects for the largest page size that fits and
 * returns that whole page -- never a JSON cut in half. If not even a 1-row page fits it throws (`safeTool` turns it
 * into a deterministic `isError`): a truncated JSON is worse than an error.
 */
export function cappedJsonResult<T extends Record<string, unknown>>(data: T, opts: ByteCappedResultOptions<T>): CallToolResult {
  const fits = (candidate: T): boolean => Buffer.byteLength(JSON.stringify(jsonResult(candidate)), 'utf8') <= opts.maxBytes;
  if (fits(data)) return jsonResult(data);

  let low = 1;
  let high = opts.pageSize - 1;
  let best: T | undefined;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = opts.build(mid);
    if (fits(candidate)) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (!best) throw new Error(`Result exceeds the ${opts.maxBytes}-byte limit even with a single row (page size ${opts.pageSize}); narrow the query.`);
  return jsonResult(best);
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
