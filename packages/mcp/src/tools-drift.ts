import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { docId, DRIFT_REPORT_MAX_BYTES, MAX_ISSUE_PAGE_LIMIT, summarizeRefreshReport, type DriftReportSummaryOptions, type IssueKind, type RefreshReport } from '@prdm/core';
import type { PrdmDeps } from './deps.js';
import { requireDocumentsPort } from './deps.js';
import { cappedJsonResult, DESTRUCTIVE_IDEMPOTENT, jsonResult, READ_ONLY, safeTool, WRITE_IDEMPOTENT } from './shared.js';

/**
 * WO ids only (architect gate, ADR-002 D15): acknowledging a Blueprint, Feature or `all` re-baselines other
 * people's work without their review and is CLI-only (`prdm sync ack`, human/architect operated), same reasoning
 * as `prdm close`. An MCP client (agent) may only accept its own Work Order's drift.
 */
const ACK_TARGET_PATTERN = /^WO-\d{3,9}$/;
const ackTarget = z.string().regex(ACK_TARGET_PATTERN, 'acknowledge_sync only accepts a Work Order id (e.g. WO-001); acknowledging a Blueprint, Feature or "all" is CLI-only (`prdm sync ack`)');

/** Runtime list of `IssueKind` (core only exports the type); the exhaustiveness guard breaks the build if core adds a kind. */
const ISSUE_KINDS = [
  'broken_link',
  'invalid_link_target',
  'feature_changed',
  'blueprint_changed',
  'code_out_of_sync',
  'work_order_out_of_sync',
  'status_write_failed',
  'impacts_warning',
  'deprecated_field',
  'lifecycle_violation',
  'awaiting_ci_report',
  'landed_but_open',
] as const satisfies readonly IssueKind[];
type MissingIssueKind = Exclude<IssueKind, (typeof ISSUE_KINDS)[number]>;
type AssertNever<T extends never> = T;
type IssueKindsAreExhaustive = AssertNever<MissingIssueKind>;

const driftReportInput = {
  kind: z.enum(ISSUE_KINDS).optional().describe('Only issues of this kind (see byKind in the response).'),
  severity: z.enum(['error', 'warning']).optional().describe('Only issues of this severity (see bySeverity in the response).'),
  limit: z.number().int().min(1).max(MAX_ISSUE_PAGE_LIMIT).optional().describe('Page size of issues.items, default 25, maximum 50.'),
  offset: z.number().int().min(0).optional().describe('Rows of the filtered set to skip, default 0.'),
};

const SUMMARY_SHAPE =
  'Returns a bounded summary, never the raw report: `documents`, `hasBlockingIssues`, `baselineWritten`, `errors{total,items,truncated}`, `issues{total,byKind,bySeverity,matched,items,limit,offset,nextOffset,truncated}`, `governed{total,synced,outOfSync,byReason}` (the full governed list is never returned) and `workOrderUpdates{total,items}`. Filter issues with `kind` and `severity`; page with `limit` (default 25, maximum 50) and `offset`, continuing from `nextOffset` (null at the end). `issues.total`, `byKind` and `bySeverity` always describe the whole report while `matched` counts the filtered set. The response is capped at 64 KiB: if a page does not fit, it is shrunk and `issues.truncated` is true — request the next page with `offset: nextOffset`.';

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
    ? `Re-scans the repository and reports drift: scan errors, issues (broken links, changed Blueprints/Features, code out of sync, stale Work Orders), the current governed-code state and any Work Order status changes it just applied. Check \`hasBlockingIssues\` before claiming or completing work. ${SUMMARY_SHAPE}`
    : `Returns the last computed drift report (scan errors, issues, governed-code state, Work Order status changes) without recomputing it — over the remote MCP this never re-scans; only a CI-verified code report can update it. \`hasReport: false\` means no report exists yet for this project. ${SUMMARY_SHAPE}`;

  server.registerTool(
    'get_drift_report',
    {
      title: 'Get drift report',
      description,
      inputSchema: driftReportInput,
      annotations: { title: 'Get drift report', ...WRITE_IDEMPOTENT },
    },
    safeTool(async (args: DriftReportSummaryOptions): Promise<CallToolResult> => {
      const report = opts.refresh ? await deps.engine.refresh() : await deps.engine.lastReport();
      if (!report) return jsonResult({ hasReport: false });
      const summary = summarizeRefreshReport(report, args);
      return cappedJsonResult(
        { ...summary },
        {
          maxBytes: DRIFT_REPORT_MAX_BYTES,
          pageSize: summary.issues.limit,
          build: (size) => ({ ...summarizeRefreshReport(report, { ...args, limit: size }) }),
        },
      );
    }),
  );
}

/**
 * `get_impacts_paths_drift` (SDD-021, WO-431; narrowing direction SDD-072, WO-643): read-only, so it is
 * deliberately left out of `REMOTE_AUTHORING_TOOL_NAMES` -- the caller's own `view` permission (already
 * checked before any MCP tool dispatches, `mcp-remote.ts`) is enough, no `mcp:write` scope required. It
 * needs the `RemoteDocumentsPort`, not the portable `ProjectEngine`. The write counterpart
 * (`sync_impacts_paths`) stays REST/dashboard-only by the same trust-tier reasoning as `force_close_feature`.
 */
export function registerImpactsPathsDriftTool(server: McpServer, deps: PrdmDeps): void {
  server.registerTool(
    'get_impacts_paths_drift',
    {
      title: 'Get impacts_paths drift',
      description:
        "Read-only: reconciles a published Blueprint's (SDD/ADR) impacts_paths against what its Work Orders' commits actually touch, in both directions, so an agent session can see a narrowing suggestion without opening the dashboard. `suggestedAdditions` lists files touched by commits whose message carries a `Refs: <this blueprint's Work Order>` trailer that no current pattern covers (the SDD-016 shape: a typo'd pattern silently missing its subdirectory files). `suggestedRemovals` lists current patterns that look surplus, each with its own evidence: `matchedPaths` (the files the pattern matches that only foreign commits touched), `foreignCommits` (those commits' shas, from OTHER blueprints' Work Orders), `alsoDeclaredBy` (other blueprints declaring the pattern verbatim) and `driftIssueCount`. A pattern is only suggested for removal when (a) no commit referencing one of this blueprint's own Work Orders touched a file it matches AND (b) it is de-facto shared -- at least 3 foreign commits touch it, or more than 5 blueprints declare it. Nothing here is applied: applying additions and/or removals is the admin-only `sync_impacts_paths` action, which requires echoing back the exact suggestion shown here plus a mandatory reason, and answers 409 if the suggestion changed underneath.",
      inputSchema: { blueprint_id: docId },
      annotations: { title: 'Get impacts_paths drift', ...READ_ONLY },
    },
    safeTool(async ({ blueprint_id }: { blueprint_id: string }) => {
      const drift = await requireDocumentsPort(deps).getImpactsPathsDrift(blueprint_id);
      return jsonResult(drift ? { ...drift } : { found: false });
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
