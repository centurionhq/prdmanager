/**
 * Shared plumbing for every agent tool (SDD-009 §Diseño "Herramientas", WO-169).
 *
 * `AgentToolContext` deliberately carries no organization/project *id the model could ever see or
 * control* — `orgId`/`project`/`document` are resolved once by the endpoint (WO-172) from the
 * conversation's own row, never accepted as a tool argument (SDD-009: "Ninguna recibe ids de
 * organización o proyecto"). `loadSubject` is a callback (not a plain field) so every tool call re-checks
 * the caller's actual permissions fresh — SDD-009: "atadas ... a los permisos de quien pregunta,
 * re-leídos en cada llamada" — a role change or removal mid-conversation takes effect on the very next
 * tool call, not only at the next HTTP request.
 */
import type { PermissionSubject } from '@prdm/contracts';
import type { DocumentRecord, ProjectRecord } from '@prdm/db';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { Pool } from 'pg';

export interface AgentToolContext {
  pool: Pool;
  neo4j: Neo4jGraphDatabase;
  orgId: string;
  project: ProjectRecord;
  document: DocumentRecord;
  loadSubject(): Promise<PermissionSubject>;
}

/** SDD-009 §Herramientas: "salidas acotadas a ~20 KB" — applied uniformly by the dispatcher
 * (`./index.ts`), not by each tool individually, so no tool author can forget it. */
export const TOOL_OUTPUT_MAX_BYTES = 20 * 1024;

export class AgentToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentToolError';
  }
}

export class AgentToolPermissionError extends AgentToolError {
  constructor() {
    super('forbidden', 'you do not have permission to use this tool on this project');
  }
}

/** Truncates a JSON-serialized tool result to {@link TOOL_OUTPUT_MAX_BYTES} UTF-8 bytes, appending a
 * machine-readable marker rather than cutting mid-token silently — the model (and a human reviewing the
 * transcript) can tell the output was cut, rather than mistaking a truncated JSON string for the whole
 * answer. Operates on the already-serialized string so every tool's differently-shaped output goes
 * through exactly one size policy. */
export function truncateToolOutput(json: string): string {
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= TOOL_OUTPUT_MAX_BYTES) return json;
  // Buffer byte-truncation can split a multi-byte UTF-8 character; `toString` silently drops the partial
  // trailing bytes of such a character rather than emitting replacement characters, which is exactly the
  // conservative behavior wanted here (a slightly-shorter valid string over a corrupted one).
  const truncated = Buffer.from(json, 'utf8').subarray(0, TOOL_OUTPUT_MAX_BYTES).toString('utf8');
  return `${truncated}\n… [truncated: output exceeded ${TOOL_OUTPUT_MAX_BYTES} bytes]`;
}
