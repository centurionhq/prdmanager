/**
 * Remote-only write tools (SDD-010 "MCP remoto", WO-184/WO-186, revisited post-migration when this
 * repository dogfooded its own remote governance and found `generate_work_orders` reachable only from
 * the dashboard left no way for a developer's code assistant to turn a blueprint's checklist into
 * claimable Work Orders at all once a project has no local/stdio project left): `claim_work_order`,
 * `complete_work_order`, `submit_feedback` and `generate_work_orders` are the only write tools ever
 * exposed over `/mcp/:graphProjectId`, and each additionally needs the *role* check SDD-010's own
 * profile table lists (`mcp:write` alone isn't enough — a viewer with a stray `mcp:write`-scoped token
 * still can't claim work) — something the local/stdio profile never needed, since a local session has no
 * per-project role concept at all. `generate_work_orders` keeps the "architect-gated" intent
 * `tools-write.ts`'s own comment describes for the local profile: gated to `admin`/`editor` project
 * roles (`@prdm/contracts`'s `generate_work_orders` permission), never `developer` — turning a
 * blueprint's prose checklist into governance structure stays a reviewed, higher-trust action than
 * claiming/completing an already-generated Work Order. Registered separately from `tools-write.ts`'s
 * `registerCoreWriteTools` (used verbatim by the local profile) rather than adding a profile branch
 * inside it, so the local/stdio tool set is provably untouched by this file.
 *
 * WO-186 layers two remote-only rules on top of `@prdm/core`'s ordinary `claimWorkOrder`/
 * `completeWorkOrder`:
 *  - `claim_work_order`'s `assignee` must resolve to `dev:<the calling token's own handle>` or
 *    `agent:<name>` — a remote caller can never claim on behalf of an arbitrary actor string (a
 *    `dev:someone-else` assignee is rejected outright, before `@prdm/core` ever sees it). The actual
 *    authenticated user is recorded via `auth.audit`, never just the actor string the request claims.
 *  - `complete_work_order`'s `commit_sha` is mandatory (optional for local/stdio, where there's no
 *    concept of a CI-verified commit at all); `@prdm/core`'s own `completeWorkOrder` already refuses a
 *    sha that doesn't resolve to a `trust: 'baseline'` commit referencing this work order (SDD-007's
 *    `PgProjectEngine.readCommit` only ever returns baseline-trusted rows) — this file only needs to
 *    catch `CommitNotVerifiedError` and turn it into the specific, actionable `commit_not_verified_by_ci`
 *    error code SDD-010 calls for, instead of letting `safeTool`'s generic error boundary flatten it to
 *    a bare message string.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { addBlueprintTask, claimWorkOrder, CommitNotVerifiedError, completeWorkOrder, docId, generateWorkOrders, SHA_PATTERN, submitFeedback } from '@prdm/core';
import { can, type PermissionAction, type PermissionSubject } from '@prdm/contracts';
import type { PrdmDeps } from './deps.js';
import { jsonResult, safeTool, WRITE_ONCE } from './shared.js';

export interface RemoteWriteAuth {
  subject: PermissionSubject;
  /** The calling token's own granted scopes (SDD-006) — `mcp:write` is checked here, per call, on top
   * of the route's own baseline `mcp:read`/`mcp:write` resolution. */
  scopes: readonly string[];
  /** The calling personal token's own user handle (SDD-010, WO-186): `claim_work_order`'s `assignee`
   * must resolve to `dev:<callerHandle>` or `agent:<name>` — never an arbitrary actor string claimed on
   * someone else's behalf. */
  callerHandle: string;
  /** Records an audit entry keyed by the actually-authenticated user (`claimed_by_user_id`, never just
   * the actor string a request claims) — supplied by the HTTP route so this package never needs its
   * own database dependency. */
  audit: (action: string, target: string, metadata?: Record<string, unknown>) => Promise<void>;
}

function toolErrorResult(code: string, message: string): CallToolResult {
  const data = { error: code, message };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

/** `null` when allowed; an explanatory error code otherwise. */
export function denyRemoteWrite(auth: RemoteWriteAuth, action: PermissionAction): CallToolResult | null {
  if (!auth.scopes.includes('mcp:write')) return toolErrorResult('missing_scope', 'this token does not carry the mcp:write scope');
  if (!can(auth.subject, action)) return toolErrorResult('insufficient_role', `your role does not permit ${action}`);
  return null;
}

const AGENT_ACTOR_PATTERN = /^agent:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** `null` when `assignee` is acceptable for this caller; an explanatory error code otherwise. */
function denyAssignee(auth: RemoteWriteAuth, assignee: string): CallToolResult | null {
  const expectedDevActor = `dev:${auth.callerHandle}`;
  if (assignee === expectedDevActor || AGENT_ACTOR_PATTERN.test(assignee)) return null;
  return toolErrorResult('assignee_not_self', `assignee must be "${expectedDevActor}" (this token's own handle) or "agent:<name>", not "${assignee}"`);
}

export function registerRemoteWriteTools(server: McpServer, deps: PrdmDeps, auth: RemoteWriteAuth): void {
  server.registerTool(
    'claim_work_order',
    {
      title: 'Claim work order',
      description:
        "Claims a pending/out_of_sync Work Order, moving it to in_progress. Over the remote MCP, assignee must be this token's own \"dev:<handle>\" or an \"agent:<name>\" — never another developer's handle. Call get_work_order_context right after claiming and before writing any code.",
      inputSchema: { id: docId, assignee: z.string().min(1) },
      annotations: { title: 'Claim work order', ...WRITE_ONCE },
    },
    safeTool(async ({ id, assignee }: { id: string; assignee: string }) => {
      const scopeDenial = denyRemoteWrite(auth, 'claim_work_order');
      if (scopeDenial) return scopeDenial;
      const assigneeDenial = denyAssignee(auth, assignee);
      if (assigneeDenial) return assigneeDenial;

      const result = await claimWorkOrder(deps.engine, id, assignee);
      await auth.audit('mcp.claim_work_order', id, { assignee });
      return jsonResult({ ...result });
    }),
  );

  server.registerTool(
    'complete_work_order',
    {
      title: 'Complete work order',
      description:
        'Marks an in_progress/out_of_sync Work Order as done. Over the remote MCP, commit_sha is mandatory and must be a commit already reported and verified by CI (trust: baseline) whose message contains the trailer `Refs: <id>` — anything else is rejected with commit_not_verified_by_ci, never silently accepted.',
      inputSchema: { id: docId, commit_sha: z.string().regex(SHA_PATTERN, 'invalid commit sha') },
      annotations: { title: 'Complete work order', ...WRITE_ONCE },
    },
    safeTool(async ({ id, commit_sha }: { id: string; commit_sha: string }) => {
      const denial = denyRemoteWrite(auth, 'complete_work_order');
      if (denial) return denial;

      try {
        const result = await completeWorkOrder(deps.engine, id, { commitSha: commit_sha });
        await auth.audit('mcp.complete_work_order', id, { commitSha: commit_sha });
        return jsonResult({ ...result });
      } catch (err) {
        if (err instanceof CommitNotVerifiedError) return toolErrorResult('commit_not_verified_by_ci', err.message);
        throw err;
      }
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
      const result = await submitFeedback(deps.engine, args);
      await auth.audit('mcp.submit_feedback', result.id);
      return jsonResult({ ...result });
    }),
  );

  server.registerTool(
    'generate_work_orders',
    {
      title: 'Generate work orders',
      description:
        'Converts the `## Tareas`/`## Tasks` checklist of a Blueprint (SDD/ADR) into WO-xxx documents; tasks already turned into Work Orders are skipped, so re-running after editing the checklist is safe. Requires an admin/editor project role. Follow up with list_work_orders/claim_work_order.',
      inputSchema: { blueprint_id: docId },
      annotations: { title: 'Generate work orders', ...WRITE_ONCE },
    },
    safeTool(async ({ blueprint_id }: { blueprint_id: string }) => {
      const denial = denyRemoteWrite(auth, 'generate_work_orders');
      if (denial) return denial;

      const result = await generateWorkOrders(deps.engine, blueprint_id);
      await auth.audit('mcp.generate_work_orders', blueprint_id, { created: result.created.length });
      return jsonResult({ ...result });
    }),
  );

  server.registerTool(
    'add_blueprint_task',
    {
      title: 'Add blueprint task',
      description:
        'Appends one `- [ ] <text>` item to a Blueprint\'s (SDD/ADR) `## Tareas`/`## Tasks` checklist, creating the section if the blueprint has none yet. Requires an admin/editor project role. Follow up with generate_work_orders on the same blueprint_id to turn it into a claimable Work Order.',
      inputSchema: { blueprint_id: docId, task: z.string().min(1).max(500) },
      annotations: { title: 'Add blueprint task', ...WRITE_ONCE },
    },
    safeTool(async ({ blueprint_id, task }: { blueprint_id: string; task: string }) => {
      const denial = denyRemoteWrite(auth, 'generate_work_orders');
      if (denial) return denial;

      const result = await addBlueprintTask(deps.engine, blueprint_id, task);
      await auth.audit('mcp.add_blueprint_task', blueprint_id, { task });
      return jsonResult({ ...result });
    }),
  );
}
