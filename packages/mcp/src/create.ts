import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrdmDeps } from './deps.js';
import { registerPrdmTools, type RegisterPrdmToolsOptions } from './tools.js';

function readPackageVersion(): string {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

/** Read exactly once per process (SDD-010, WO-184: "los metadatos del servidor — versión — se leen una
 * vez al arrancar, no por request") — `createPrdmServer` is called once per request in the remote MCP
 * profile, so re-reading `package.json` from disk on every call would defeat that. */
const CACHED_VERSION = readPackageVersion();

/** Builds the prdm-graph McpServer in-process so production and tests share the exact same wiring. */
export function createPrdmServer(deps: PrdmDeps, opts?: RegisterPrdmToolsOptions): McpServer {
  const server = new McpServer({ name: 'prdm-graph', version: CACHED_VERSION });
  registerPrdmTools(server, deps, opts);
  return server;
}
