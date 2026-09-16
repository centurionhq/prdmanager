import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrdmDeps } from './deps.js';
import { registerImplementWorkOrderPrompt, registerPrdmPrompts } from './prompts.js';
import { registerPrdmResources } from './resources.js';
import { registerAuthoringTools, registerProjectSummaryTools } from './tools-authoring.js';
import { registerDriftReportTool, registerDriftTools } from './tools-drift.js';
import { registerReadTools } from './tools-read.js';
import { registerWriteTools } from './tools-write.js';

export type { PrdmDeps } from './deps.js';

export type PrdmMcpProfile = 'local' | 'remote';

export interface RegisterPrdmToolsOptions {
  /**
   * `'local'` (default, stdio): every tool, resource and prompt this module has, unchanged.
   * `'remote'` (SDD-010's `/mcp/:graphProjectId`, WO-184): read tools, `get_project`/
   * `get_closure_readiness`, a non-refreshing `get_drift_report`, read-only resources and the
   * `implement_work_order` prompt only — never any authoring tool/prompt, `acknowledge_sync`,
   * `refresh_index`, `create_feature_request` or `attach_artifact` (SDD-010's own table: document
   * authoring and drift-acknowledgment only happen in the dashboard). The four remote write tools
   * (`claim_work_order`/`complete_work_order`/`submit_feedback`/`generate_work_orders`) are deliberately
   * NOT registered here — they need a per-caller `RemoteWriteAuth` this generic function has no reason to
   * know about; the HTTP route calls `registerRemoteWriteTools` itself once it has resolved one.
   */
  profile?: PrdmMcpProfile;
}

/** Registers every prdm-graph tool, resource and prompt on the given server for the requested profile
 * (default `'local'`, the existing full stdio set — unchanged). */
export function registerPrdmTools(server: McpServer, deps: PrdmDeps, opts?: RegisterPrdmToolsOptions): void {
  if (opts?.profile === 'remote') {
    registerReadTools(server, deps);
    registerProjectSummaryTools(server, deps);
    registerDriftReportTool(server, deps, { refresh: false });
    registerPrdmResources(server, deps);
    registerImplementWorkOrderPrompt(server, deps);
    return;
  }

  registerReadTools(server, deps);
  registerDriftTools(server, deps);
  registerWriteTools(server, deps);
  registerAuthoringTools(server, deps);
  registerPrdmResources(server, deps);
  registerPrdmPrompts(server, deps);
}
