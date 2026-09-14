import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrdmDeps } from './deps.js';
import { registerPrdmPrompts } from './prompts.js';
import { registerPrdmResources } from './resources.js';
import { registerAuthoringTools } from './tools-authoring.js';
import { registerDriftTools } from './tools-drift.js';
import { registerReadTools } from './tools-read.js';
import { registerWriteTools } from './tools-write.js';

export type { PrdmDeps } from './deps.js';

export interface RegisterPrdmToolsOptions {
  /**
   * Reserved for a future remote profile (SDD-010) that registers a narrower tool set (e.g. no authoring tools
   * where `deps.authoring` is absent). Unused today: every profile currently registers the same full set, and
   * `deps.authoring` being optional (WO-126) already makes each authoring tool fail with a clear error instead
   * of crashing if it's ever called without one.
   */
  profile?: string;
}

/** Registers every prdm-graph tool, resource and prompt on the given server. */
export function registerPrdmTools(server: McpServer, deps: PrdmDeps, _opts?: RegisterPrdmToolsOptions): void {
  registerReadTools(server, deps);
  registerDriftTools(server, deps);
  registerWriteTools(server, deps);
  registerAuthoringTools(server, deps);
  registerPrdmResources(server, deps);
  registerPrdmPrompts(server, deps);
}
