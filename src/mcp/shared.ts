import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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

/** Never leaks stack traces: only Error#message (or String(err)) is sent to the client. */
export function errorResult(err: unknown): CallToolResult {
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

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
export const WRITE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;
export const WRITE_ONCE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
