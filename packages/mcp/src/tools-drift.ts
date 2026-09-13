import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { RefreshReport } from '@prdm/core';
import type { PrdmDeps } from './deps.js';
import { DESTRUCTIVE_IDEMPOTENT, jsonResult, safeTool, WRITE_IDEMPOTENT } from './shared.js';

/**
 * WO ids only (architect gate, ADR-002 D15): acknowledging a Blueprint, Feature or `all` re-baselines other
 * people's work without their review and is CLI-only (`prdm sync ack`, human/architect operated), same reasoning
 * as `prdm close`. An MCP client (agent) may only accept its own Work Order's drift.
 */
const ACK_TARGET_PATTERN = /^WO-\d{3,9}$/;
const ackTarget = z.string().regex(ACK_TARGET_PATTERN, 'acknowledge_sync only accepts a Work Order id (e.g. WO-001); acknowledging a Blueprint, Feature or "all" is CLI-only (`prdm sync ack`)');

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
        'Accepts the current state of a Work Order as its new baseline. This removes a drift guardrail: only use it after a human confirmed the change needs no rework. Acknowledging a Blueprint, Feature or "all" is CLI-only (`prdm sync ack`, architect gate like `prdm close`); this tool rejects anything other than a WO-xxx id.',
      inputSchema: { target: ackTarget },
      annotations: { title: 'Acknowledge sync', ...DESTRUCTIVE_IDEMPOTENT },
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
