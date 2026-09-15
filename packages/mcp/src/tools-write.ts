import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ACTOR_PATTERN,
  ARTIFACT_SOURCES,
  attachArtifact,
  claimWorkOrder,
  completeWorkOrder,
  createFeatureRequest,
  docId,
  generateWorkOrders,
  SHA_PATTERN,
  submitFeedback,
  type ArtifactSource,
} from '@prdm/core';
import type { PrdmDeps } from './deps.js';
import { jsonResult, safeTool, WRITE_IDEMPOTENT, WRITE_ONCE } from './shared.js';


/** `generate_work_orders`/`create_feature_request`/`attach_artifact` (SDD-010's remote profile,
 * WO-184): local/stdio profile only — the remote MCP has no `create_feature_request`/`attach_artifact`
 * (authoring stays dashboard-only) and `generate_work_orders` is architect-gated, never a remote-agent
 * action. */
export function registerAuthoringWriteTools(server: McpServer, deps: PrdmDeps): void {
  server.registerTool(
    'generate_work_orders',
    {
      title: 'Generate work orders',
      description:
        'Converts the `## Tareas`/`## Tasks` checklist of a Blueprint (SDD/ADR) into WO-xxx documents; tasks already turned into Work Orders are skipped, so re-running after editing the checklist is safe. Follow up with list_work_orders/claim_work_order.',
      inputSchema: { blueprint_id: docId },
      annotations: { title: 'Generate work orders', ...WRITE_IDEMPOTENT },
    },
    safeTool(async ({ blueprint_id }: { blueprint_id: string }) => jsonResult({ ...(await generateWorkOrders(deps.engine, blueprint_id)) })),
  );

  server.registerTool(
    'create_feature_request',
    {
      title: 'Create feature request',
      description:
        'Promotes an idea into a proposed FR-xxx Feature evolving from an existing Feature (parent_id). Requires justified_by (one or more existing Feedback/Artifact ids); pass feedback_id as a legacy shorthand for justified_by: [feedback_id] that also links the originating feedback back via INFORMS. Typically used after triage_feedback/submit_feedback returns no auto-link.',
      inputSchema: {
        title: z.string().min(1).max(300),
        description: z.string().min(1).max(20_000),
        parent_id: docId,
        justified_by: z.array(docId).optional(),
        feedback_id: docId.optional(),
      },
      annotations: { title: 'Create feature request', ...WRITE_ONCE },
    },
    safeTool(
      async ({
        title,
        description,
        parent_id,
        justified_by,
        feedback_id,
      }: {
        title: string;
        description: string;
        parent_id: string;
        justified_by?: string[];
        feedback_id?: string;
      }) => jsonResult({ ...(await createFeatureRequest(deps.engine, { title, description, parentId: parent_id, justifiedBy: justified_by, feedbackId: feedback_id })) }),
    ),
  );

  server.registerTool(
    'attach_artifact',
    {
      title: 'Attach artifact',
      description:
        'Attaches a piece of context (meeting notes, call transcript, email, etc.) as an ART-xxx document from inline content only; this tool never reads local files. Explicit `links` win over auto-linking; otherwise the content is triaged against the Feature Tree. Fails before writing when no link is found unless root is set (standalone context with no Feature yet).',
      inputSchema: {
        title: z.string().min(1).max(300),
        content: z.string().min(1),
        source: z.enum(ARTIFACT_SOURCES).default('other'),
        links: z.array(docId).optional(),
        root: z.boolean().optional(),
      },
      annotations: { title: 'Attach artifact', ...WRITE_ONCE },
    },
    safeTool(async (args: { title: string; content: string; source: ArtifactSource; links?: string[]; root?: boolean }) =>
      jsonResult({ ...(await attachArtifact(deps.engine, args)) }),
    ),
  );
}

/** `claim_work_order`/`complete_work_order`/`submit_feedback` (SDD-010's remote profile, WO-184): the
 * only three write tools the remote MCP ever exposes — shared verbatim by both profiles today.
 * WO-186 layers additional remote-only checks (assignee bound to the calling token's handle,
 * `commit_sha` verified against a CI-baseline-trusted commit) on top of a dedicated remote
 * registration, without changing this local/stdio-facing one. */
export function registerCoreWriteTools(server: McpServer, deps: PrdmDeps): void {
  server.registerTool(
    'claim_work_order',
    {
      title: 'Claim work order',
      description:
        'Claims a pending/out_of_sync Work Order for an actor (assignee must look like `agent:name` or `dev:name`), moving it to in_progress. Call get_work_order_context right after claiming and before writing any code.',
      inputSchema: { id: docId, assignee: z.string().regex(ACTOR_PATTERN, 'assignee must look like agent:name or dev:name') },
      annotations: { title: 'Claim work order', ...WRITE_ONCE },
    },
    safeTool(async ({ id, assignee }: { id: string; assignee: string }) => jsonResult({ ...(await claimWorkOrder(deps.engine, id, assignee)) })),
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
    safeTool(async ({ id, commit_sha }: { id: string; commit_sha?: string }) =>
      jsonResult({ ...(await completeWorkOrder(deps.engine, id, { commitSha: commit_sha })) }),
    ),
  );

  server.registerTool(
    'submit_feedback',
    {
      title: 'Submit feedback',
      description:
        'Records raw feedback as an FB-xxx document and immediately triages it: a clearly matching Feature (explicit mention or high full-text score) is auto-linked via INFORMS; otherwise the response carries ranked candidates and a suggested title so the assistant can decide whether to call create_feature_request.',
      inputSchema: {
        text: z.string().min(1).max(20_000),
        source: z.string().min(1).max(60),
        customer: z.string().max(120).optional(),
        title: z.string().min(1).max(300).optional(),
      },
      annotations: { title: 'Submit feedback', ...WRITE_ONCE },
    },
    safeTool(async (args: { text: string; source: string; customer?: string; title?: string }) => jsonResult({ ...(await submitFeedback(deps.engine, args)) })),
  );
}

/** Full local/stdio write tool set: everything `registerCoreWriteTools` and `registerAuthoringWriteTools`
 * together register — unchanged behavior for the existing stdio server. */
export function registerWriteTools(server: McpServer, deps: PrdmDeps): void {
  registerCoreWriteTools(server, deps);
  registerAuthoringWriteTools(server, deps);
}
