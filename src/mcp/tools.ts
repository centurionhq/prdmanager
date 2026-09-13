import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrdmDeps } from './deps.js';
import { registerPrdmPrompts } from './prompts.js';
import { registerPrdmResources } from './resources.js';
import { registerDriftTools } from './tools-drift.js';
import { registerReadTools } from './tools-read.js';
import { registerWriteTools } from './tools-write.js';

export type { PrdmDeps } from './deps.js';

/** Registers every prdm-graph tool, resource and prompt on the given server. */
export function registerPrdmTools(server: McpServer, deps: PrdmDeps): void {
  registerReadTools(server, deps);
  registerDriftTools(server, deps);
  registerWriteTools(server, deps);
  registerPrdmResources(server, deps);
  registerPrdmPrompts(server, deps);
}
