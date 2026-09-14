/**
 * Remote-only write tools (SDD-010 "MCP remoto", WO-184/WO-186): `claim_work_order`,
 * `complete_work_order` and `submit_feedback` are the only three write tools ever exposed over
 * `/mcp/:graphProjectId`, and each additionally needs the *role* check SDD-010's own profile table
 * lists (`mcp:write` alone isn't enough — a viewer with a stray `mcp:write`-scoped token still can't
 * claim work) — something the local/stdio profile never needed, since a local session has no
 * per-project role concept at all. Registered separately from `tools-write.ts`'s
 * `registerCoreWriteTools` (used verbatim by the local profile) rather than adding a profile branch
 * inside it, so the local/stdio tool set is provably untouched by this file.
 *
 * `claim_work_order`/`complete_work_order` here are WO-184's placeholder shape (the same underlying
 * `@prdm/core` calls as local); WO-186 replaces their bodies with the remote-specific assignee/commit
 * rules without touching this file's registration shape or the role-check wrapper.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ACTOR_PATTERN, claimWorkOrder, completeWorkOrder, docId, SHA_PATTERN, submitFeedback } from '@prdm/core';
import { can, type PermissionAction, type PermissionSubject } from '@prdm/contracts';
import type { PrdmDeps } from './deps.js';
import { jsonResult, safeTool, WRITE_ONCE } from './shared.js';

export interface RemoteWriteAuth {
  subject: PermissionSubject;
  /** The calling token's own granted scopes (SDD-006) — `mcp:write` is checked here, per call, on top
   * of the route's own baseline `mcp:read`/`mcp:write` resolution. */
  scopes: readonly string[];
}

function forbiddenResult(code: string, message: string): CallToolResult {
  const data = { error: code, message };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

/** `null` when allowed; an explanatory error code otherwise. Exported for WO-186's own remote
 * claim/complete replacements to reuse the exact same check. */
export function denyRemoteWrite(auth: RemoteWriteAuth, action: PermissionAction): CallToolResult | null {
  if (!auth.scopes.includes('mcp:write')) return forbiddenResult('missing_scope', 'this token does not carry the mcp:write scope');
  if (!can(auth.subject, action)) return forbiddenResult('insufficient_role', `your role does not permit ${action}`);
  return null;
}

export function registerRemoteWriteTools(server: McpServer, deps: PrdmDeps, auth: RemoteWriteAuth): void {
  server.registerTool(
    'claim_work_order',
    {
      title: 'Claim work order',
      description:
        'Claims a pending/out_of_sync Work Order for an actor (assignee must look like `agent:name` or `dev:name`), moving it to in_progress. Call get_work_order_context right after claiming and before writing any code.',
      inputSchema: { id: docId, assignee: z.string().regex(ACTOR_PATTERN, 'assignee must look like agent:name or dev:name') },
      annotations: { title: 'Claim work order', ...WRITE_ONCE },
    },
    safeTool(async ({ id, assignee }: { id: string; assignee: string }) => {
      const denial = denyRemoteWrite(auth, 'claim_work_order');
      if (denial) return denial;
      return jsonResult({ ...(await claimWorkOrder(deps.engine, id, assignee)) });
    }),
  );

  server.registerTool(
    'complete_work_order',
    {
      title: 'Complete work order',
      description:
        'Marks an in_progress/out_of_sync Work Order as done and records the sha of the commit that resolved it. Call this only after the code is committed with a message containing the trailer `Refs: <id>`; the response includes any remaining drift for the Work Order and its Blueprints.',
      inputSchema: { id: docId, commit_sha: z.string().regex(SHA_PATTERN, 'invalid commit sha').optional() },
      annotations: { title: 'Complete work order', ...WRITE_ONCE },
    },
    safeTool(async ({ id, commit_sha }: { id: string; commit_sha?: string }) => {
      const denial = denyRemoteWrite(auth, 'complete_work_order');
      if (denial) return denial;
      return jsonResult({ ...(await completeWorkOrder(deps.engine, id, { commitSha: commit_sha })) });
    }),
  );

  server.registerTool(
    'submit_feedback',
    {
      title: 'Submit feedback',
      description:
        'Records raw feedback as an FB-xxx document and immediately triages it: a clearly matching Feature (explicit mention or high full-text score) is auto-linked via INFORMS; otherwise the response carries ranked candidates and a suggested title.',
      inputSchema: {
        text: z.string().min(1).max(20_000),
        source: z.string().min(1).max(60),
        customer: z.string().max(120).optional(),
        title: z.string().min(1).max(300).optional(),
      },
      annotations: { title: 'Submit feedback', ...WRITE_ONCE },
    },
    safeTool(async (args: { text: string; source: string; customer?: string; title?: string }) => {
      const denial = denyRemoteWrite(auth, 'submit_feedback');
      if (denial) return denial;
      return jsonResult({ ...(await submitFeedback(deps.engine, args)) });
    }),
  );
}
