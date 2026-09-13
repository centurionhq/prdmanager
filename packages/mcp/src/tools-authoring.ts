import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { closureReadiness, docId, DOC_KINDS, DRAFT_KINDS, DraftValidationError, scanDocuments, type DocKind, type DraftKind } from '@prdm/core';
import type { PrdmDeps } from './deps.js';
import { DESTRUCTIVE_IDEMPOTENT, jsonResult, jsonText, READ_ONLY, safeReadTool, safeTool, WRITE_ONCE } from './shared.js';

const draftKindEnum = z.enum(DRAFT_KINDS as unknown as [string, ...string[]]);

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_FIELDS = 30;

const authoringFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

const authoringFieldsSchema = z
  .record(z.string(), authoringFieldValueSchema)
  .refine((fields) => Object.keys(fields).length <= MAX_FIELDS, { message: `fields cannot have more than ${MAX_FIELDS} keys` })
  .refine((fields) => Object.keys(fields).every((key) => FIELD_KEY_PATTERN.test(key)), { message: 'field keys must be snake_case' });

/** One short sentence per document kind summarizing its PRD-002 §3 lifecycle gate (SDD-002 "Ciclo de vida"). */
const LIFECYCLE_RULES: Readonly<Record<DocKind, string>> = {
  MRD: 'needs a "justified_by" link to an existing Feedback/Artifact (or one of those linking back via informs/provides_context_for)',
  PRD: 'needs a "justified_by" link to an existing Feedback/Artifact (or one of those linking back via informs/provides_context_for)',
  FR: 'needs a "justified_by" link to an existing Feedback/Artifact (or one of those linking back via informs/provides_context_for)',
  SDD: 'needs non-empty "impacts_paths" and a "## Tareas"/"## Tasks" checklist with at least one item before work orders can be generated',
  ADR: 'needs non-empty "impacts_paths" and a "## Tareas"/"## Tasks" checklist with at least one item before work orders can be generated',
  WO: 'generated only by generate_work_orders from a blueprint checklist; never drafted or committed directly',
  FB: 'needs "informs" (or root: true) to justify a feature; a "new" one with neither is only a warning',
  ART: 'needs "provides_context_for" (or root: true) to justify a feature',
};

function bodySchema(maxBytes: number) {
  return z
    .string()
    .min(1)
    .max(200_000)
    .superRefine((value, ctx) => {
      if (Buffer.byteLength(value, 'utf8') > maxBytes) {
        ctx.addIssue({ code: 'custom', message: `body exceeds the ${maxBytes}-byte limit` });
      }
    });
}

export interface ProjectSummary {
  id: string;
  name: string;
  folders: Record<DocKind, string>;
  lifecycle: Record<DocKind, string>;
  counts: Record<DocKind, number>;
  openDrafts: number;
  draftableKinds: readonly DraftKind[];
}

/** Shared by the `get_project` tool and the `prdm://project` resource so both report the exact same data. */
export async function buildProjectSummary(deps: PrdmDeps): Promise<ProjectSummary> {
  const { docs } = await scanDocuments(deps.engine.config.root, deps.engine.config.ignore);
  const counts = Object.fromEntries(DOC_KINDS.map((kind) => [kind, 0])) as Record<DocKind, number>;
  for (const doc of docs) counts[doc.node.kind] += 1;
  return {
    id: deps.config.project.id,
    name: deps.config.project.name,
    folders: deps.config.folders,
    lifecycle: LIFECYCLE_RULES,
    counts,
    openDrafts: deps.authoring.list().length,
    draftableKinds: DRAFT_KINDS,
  };
}

/** DraftValidationError -> a structured isError result listing every issue, never a stack trace. */
function draftValidationErrorResult(err: DraftValidationError): CallToolResult {
  const data = { error: 'draft_validation_failed', draftId: err.draftId, issues: err.issues };
  return { isError: true, content: [{ type: 'text', text: jsonText(data) }], structuredContent: data };
}

export function registerAuthoringTools(server: McpServer, deps: PrdmDeps): void {
  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        'Returns the active project: id, name, its folder map per document kind, a one-line lifecycle rule per kind (PRD-002 §3), current document counts, the number of open drafts and which kinds can be drafted (every kind except WO). Call this before author_artifact to know the project name and rules.',
      inputSchema: {},
      annotations: { title: 'Get project', ...READ_ONLY },
    },
    safeReadTool(deps, async () => jsonResult({ ...(await buildProjectSummary(deps)) })),
  );

  server.registerTool(
    'draft_artifact',
    {
      title: 'Draft artifact',
      description:
        'Opens or updates an in-memory draft of a new (or, with update_id, existing) document and live-validates it: schema, forbidden fields, broken/invalid links, dependencies on other uncommitted drafts and PRD-002 §3 lifecycle rules. Nothing is written to disk; read the returned `rendered` text and `validation.issues`, fix them by calling this again with the same draft_id and expected_revision, then call commit_artifact only after the user confirms. Work Orders (kind WO) cannot be drafted; use generate_work_orders instead.',
      inputSchema: {
        kind: draftKindEnum,
        title: z.string().min(1).max(300),
        body: bodySchema(deps.config.authoring.maxDraftBytes),
        fields: authoringFieldsSchema.optional(),
        draft_id: z.string().min(1).optional(),
        update_id: docId.optional(),
        expected_revision: z.number().int().nonnegative().optional(),
      },
      annotations: { title: 'Draft artifact', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    safeTool(
      async (args: {
        kind: string;
        title: string;
        body: string;
        fields?: Record<string, string | number | boolean | string[]>;
        draft_id?: string;
        update_id?: string;
        expected_revision?: number;
      }) =>
        jsonResult({
          ...(await deps.authoring.draft({
            kind: args.kind as DraftKind,
            title: args.title,
            body: args.body,
            fields: args.fields,
            draftId: args.draft_id,
            updateId: args.update_id,
            expectedRevision: args.expected_revision,
          })),
        }),
    ),
  );

  server.registerTool(
    'validate_draft',
    {
      title: 'Validate draft',
      description: 'Re-runs live validation for an open draft (schema, links, lifecycle) against the repository as it stands right now, without changing the draft. Use it to re-check a draft after something else in the project changed.',
      inputSchema: { draft_id: z.string().min(1) },
      annotations: { title: 'Validate draft', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ draft_id }: { draft_id: string }) => jsonResult({ ...(await deps.authoring.validate(draft_id)) })),
  );

  server.registerTool(
    'commit_artifact',
    {
      title: 'Commit artifact',
      description:
        'Commits a draft that has already been shown to and confirmed by the user: assigns its final id (create) or writes over the target (update), persists it atomically to disk and Neo4j, and returns the written id/path. Fails with no write at all if validation still has error-level issues (the error result lists every issue); retrying with the same draft_id and expected_revision after a successful commit returns the same result instead of erroring.',
      inputSchema: { draft_id: z.string().min(1), expected_revision: z.number().int().nonnegative() },
      annotations: { title: 'Commit artifact', ...WRITE_ONCE },
    },
    safeTool(async ({ draft_id, expected_revision }: { draft_id: string; expected_revision: number }) => {
      try {
        return jsonResult({ ...(await deps.authoring.commit(draft_id, expected_revision)) });
      } catch (err) {
        if (err instanceof DraftValidationError) return draftValidationErrorResult(err);
        throw err;
      }
    }),
  );

  server.registerTool(
    'list_drafts',
    {
      title: 'List drafts',
      description: 'Lists every open draft for this server process (id, kind, mode, target id, revision, expiry). Use it to recover context about drafts in progress.',
      inputSchema: {},
      annotations: { title: 'List drafts', ...READ_ONLY },
    },
    safeReadTool(deps, async () => jsonResult({ drafts: deps.authoring.list() })),
  );

  server.registerTool(
    'discard_draft',
    {
      title: 'Discard draft',
      description: 'Drops an open draft without committing it, freeing its slot. Safe to call on an already-discarded or expired draft id (returns discarded: false instead of erroring).',
      inputSchema: { draft_id: z.string().min(1) },
      annotations: { title: 'Discard draft', ...DESTRUCTIVE_IDEMPOTENT },
    },
    safeTool(async ({ draft_id }: { draft_id: string }) => jsonResult({ discarded: deps.authoring.discard(draft_id) })),
  );

  server.registerTool(
    'get_closure_readiness',
    {
      title: 'Get closure readiness',
      description:
        'Read-only checklist for closing a Feature (PRD-002 §3 "Cierre"): approved status, every architecting Blueprint has at least one Work Order, all of those are done, and a project-wide refresh reports zero error-level issues. There is no MCP tool to close a feature (ADR-002 D15): closure is a human gate, run with `prdm close <id> --ack --by dev:<name>` on the CLI.',
      inputSchema: { feature_id: docId },
      annotations: { title: 'Get closure readiness', ...READ_ONLY },
    },
    safeReadTool(deps, async ({ feature_id }: { feature_id: string }) => jsonResult({ ...(await closureReadiness(deps.engine, feature_id)) })),
  );
}
