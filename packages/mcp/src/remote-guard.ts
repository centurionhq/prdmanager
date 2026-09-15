/**
 * SDD-010 "Modo remoto", WO-191: the local stdio `prdm-graph` server — and every write-capable tool it
 * would otherwise register — refuses to run at all for a remote-linked repository. Its local Neo4j
 * partition, if any, is not that project's source of truth once `.prdm.yaml` has a `remote` section;
 * `prdm mcp-proxy` (configured by `prdm link --mcp`) is what a code assistant should be pointed at
 * instead. Extracted into its own module (rather than living inline in `server.ts`) so it's testable
 * without importing `server.ts`, whose top-level `main().catch(...)` runs on import.
 */
import { detectProjectFileMode } from '@prdm/core';

export class RemoteProjectStdioServerError extends Error {}

export function assertNotRemoteProject(root: string): void {
  const mode = detectProjectFileMode(root);
  if (mode.kind === 'remote') {
    throw new RemoteProjectStdioServerError(
      'this repository is linked to a remote project (.prdm.yaml has a "remote" section); the local prdm-graph MCP server refuses to run — configure "prdm mcp-proxy" in .mcp.json instead (see "prdm link --mcp")',
    );
  }
}
