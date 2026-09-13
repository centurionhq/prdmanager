import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { docId } from '../domain/schema.js';
import type { RefreshReport } from '../engine.js';
import type { PrdmDeps } from './deps.js';
import { jsonResult, safeTool, WRITE_IDEMPOTENT } from './shared.js';

function reportResult(report: RefreshReport) {
  return jsonResult({ ...report });
}

export function registerDriftTools(server: McpServer, deps: PrdmDeps): void {
  server.registerTool(
    'get_drift_report',
    {
      title: 'Get drift report',
      description:
        'Re-scans the repository and reports drift: scan errors, issues (broken links, changed Blueprints/Features, code out of sync, stale Work Orders), the current governed-code state and any Work Order status changes it just applied. Check `hasBlockingIssues` before claiming or completing work.',
      inputSchema: {},
      annotations: { title: 'Get drift report', ...WRITE_IDEMPOTENT },
    },
    safeTool(async () => reportResult(await deps.engine.refresh())),
  );

  server.registerTool(
    'acknowledge_sync',
    {
      title: 'Acknowledge sync',
      description:
        'Accepts the current state of a Blueprint (or "all" governed Blueprints) as the new baseline, clearing `blueprint_changed`/`code_out_of_sync`/`work_order_out_of_sync` issues for it. Use this after a human/agent has reviewed a drifted Blueprint and confirmed the code is intentionally different, or after re-completing the affected Work Orders.',
      inputSchema: { target: z.union([docId, z.literal('all')]) },
      annotations: { title: 'Acknowledge sync', ...WRITE_IDEMPOTENT },
    },
    safeTool(async ({ target }: { target: string }) => reportResult(await deps.engine.acknowledge(target))),
  );

  server.registerTool(
    'refresh_index',
    {
      title: 'Refresh index',
      description:
        'Rescans the docs on disk, recomputes drift and rewrites the Neo4j index (equivalent to `prdm sync` + `prdm index`). Call this after editing frontmatter or governed code outside of the other tools, before relying on read tools for up-to-date data.',
      inputSchema: {},
      annotations: { title: 'Refresh index', ...WRITE_IDEMPOTENT },
    },
    safeTool(async () => reportResult(await deps.engine.refresh())),
  );
}
