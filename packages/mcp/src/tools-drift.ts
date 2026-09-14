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

/**
 * `get_drift_report` (SDD-010's remote profile, WO-184): local/stdio always refreshes (a live
 * repository can have drifted since the last scan); the remote profile instead reads whatever
 * `lastReport()` already has — SDD-010's own table is explicit that this tool "nunca refresca" over
 * the remote MCP (only a CI-verified baseline report, WO-181, is allowed to trigger a refresh). `null`
 * (no report has ever run yet) is reported as `{ hasReport: false }` rather than an error — a normal
 * state for a project with no CI report yet, not a failure.
 */
export function registerDriftReportTool(server: McpServer, deps: PrdmDeps, opts: { refresh: boolean }): void {
  const description = opts.refresh
    ? 'Re-scans the repository and reports drift: scan errors, issues (broken links, changed Blueprints/Features, code out of sync, stale Work Orders), the current governed-code state and any Work Order status changes it just applied. Check `hasBlockingIssues` before claiming or completing work.'
    : 'Returns the last computed drift report (scan errors, issues, governed-code state, Work Order status changes) without recomputing it — over the remote MCP this never re-scans; only a CI-verified code report can update it. `hasReport: false` means no report exists yet for this project.';

  server.registerTool(
    'get_drift_report',
    {
      title: 'Get drift report',
      description,
      inputSchema: {},
      annotations: { title: 'Get drift report', ...WRITE_IDEMPOTENT },
    },
    safeTool(async () => {
      if (!opts.refresh) {
        const last = await deps.engine.lastReport();
        return last ? reportResult(last) : jsonResult({ hasReport: false });
      }
      return reportResult(await deps.engine.refresh());
    }),
  );
}

/** `acknowledge_sync`/`refresh_index`: local/stdio profile only — never exposed remotely (SDD-010's own
 * table: drift acknowledgment only happens in the dashboard). */
export function registerDriftMutationTools(server: McpServer, deps: PrdmDeps): void {
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

/** Full local/stdio drift tool set: `get_drift_report` (refreshing) + `acknowledge_sync` + `refresh_index`. */
export function registerDriftTools(server: McpServer, deps: PrdmDeps): void {
  registerDriftReportTool(server, deps, { refresh: true });
  registerDriftMutationTools(server, deps);
}
