import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrdmDeps } from './deps.js';
import { registerPrdmTools } from './tools.js';

function readPackageVersion(): string {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

/** Builds the prdm-graph McpServer in-process so production and tests share the exact same wiring. */
export function createPrdmServer(deps: PrdmDeps): McpServer {
  const server = new McpServer({ name: 'prdm-graph', version: readPackageVersion() });
  registerPrdmTools(server, deps);
  return server;
}
