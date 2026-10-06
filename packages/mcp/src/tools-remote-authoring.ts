/**
 * Remote document-authoring tools (SDD-020 "Autoria remota de documentos por MCP", WO-422/423/424): the
 * tracked, deliberate expansion of the remote-authoring boundary SDD-010 originally drew ("la autoría
 * ocurre en el dashboard") — the same kind of exception `generate_work_orders`/`add_blueprint_task`
 * already were before this. Registered from a sibling file to `tools-remote.ts` (not added to it)
 * because that file's own doc comment scopes it to WO/Feedback lifecycle, not document authoring.
 *
 * Three write tools, not one combined tool: `create_document` and `update_document` need only
 * `edit_document` (admin/editor); `publish_document` needs the stronger, admin-only `publish` permission —
 * a single tool spanning both would either over- or under-restrict one of the two. `update_document`
 * exists because an agent with no dashboard has no other way to fix a draft/in_review document that fails
 * `publish_document`'s strict validation (e.g. empty `impacts_paths`, the exact SDD-016 incident this PRD
 * traces back to) without abandoning the document id and starting over.
 *
 * The read-only `get_impacts_paths_drift` (SDD-021, WO-431; SDD-072, WO-643) is registered from here via
 * `registerImpactsPathsDriftTool` (`tools-drift.ts`), since it needs the same `RemoteDocumentsPort` this
 * file wires in rather than the portable `ProjectEngine`/`store`.
 *
 * SDD and ADR are treated identically by every tool here: both are `Blueprint` (`LABEL_BY_KIND`), same
 * `templateFor`/`validateDocument`/`checkBlueprint`. `WO` stays excluded from `create_document`'s `kind`
 * enum on purpose — a Work Order is still always machine-generated via `generate_work_orders`, never
 * authored directly, local or remote.
 *
 * WO-426: this expansion is tracked directly on the real, published SDD-010 (not this repo's own
 * `.prdm/remote/docs/SDD-010.md`, which is a read-only `prdm sync` cache, not the authoritative
 * document, and gets overwritten on the next sync) via `add_blueprint_task` — the same mechanism this
 * file's own `create_document`/`update_document`/`publish_document` exist to eventually replace for
 * ordinary content, but which is already the correct, working tool for appending a tracked note to an
 * already-published blueprint without a republish.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { docId, type DraftKind } from '@prdm/core';
import type { PrdmDeps } from './deps.js';
import { requireDocumentsPort } from './deps.js';
import { denyRemoteWrite, type RemoteWriteAuth } from './tools-remote.js';
import { registerImpactsPathsDriftTool } from './tools-drift.js';
import { jsonResult, safeTool, WRITE_ONCE } from './shared.js';

/** Mirrors `@prdm/core`'s `DRAFT_KINDS` minus `WO` (never drafted, local or remote) -- kept as a literal
 * tuple here rather than importing `DRAFT_KINDS` itself so this file's own zod enum stays a compile-time
 * literal union, matching every other tool's `inputSchema` in this package. */
const AUTHORABLE_KINDS = ['MRD', 'PRD', 'FR', 'BC', 'SDD', 'ADR', 'ART', 'FB'] as const;

/** WO-425 (SDD-018's fixed `REMOTE_WRITE_TOOL_NAMES` precedent): the single source of truth for every
 * write tool this file registers, imported by `packages/server/src/api/mcp-remote.ts` into its own
 * `mcp:write`-scope gate instead of a separately hand-maintained set. */
export const REMOTE_AUTHORING_TOOL_NAMES = ['create_document', 'update_document', 'publish_document'] as const;

const fieldsSchema = z.record(z.string(), z.unknown()).optional();

export function registerRemoteAuthoringTools(server: McpServer, deps: PrdmDeps, auth: RemoteWriteAuth): void {
  const documents = () => requireDocumentsPort(deps);

  server.registerTool(
    'create_document',
    {
      title: 'Create document',
      description:
        'Creates a new MRD/PRD/FR/SDD/ADR/ART/FB document and immediately submits it for review (draft -> in_review in one call, since MCP has no separate "click Request Review" step). Optional fields/body seed its content beyond the bare template. Requires an admin/editor project role. Follow up with publish_document once it validates, or update_document to fix it first.',
      inputSchema: {
        kind: z.enum(AUTHORABLE_KINDS),
        title: z.string().min(1).max(300),
        fields: fieldsSchema,
        body: z.string().max(50_000).optional(),
      },
      annotations: { title: 'Create document', ...WRITE_ONCE },
    },
    safeTool(async ({ kind, title, fields, body }: { kind: DraftKind; title: string; fields?: Record<string, unknown>; body?: string }) => {
      const denial = denyRemoteWrite(auth, 'edit_document');
      if (denial) return denial;

      const created = await documents().createAndSubmit(kind, title, auth.userId);

      const result = fields || body ? await documents().saveDraftVersion(created.document.docId, { fields, body, createdBy: auth.userId }) : created;

      await auth.audit('mcp.create_document', result.document.docId, { kind });
      return jsonResult({ ...result });
    }),
  );

  server.registerTool(
    'update_document',
    {
      title: 'Update document',
      description:
        'Updates a draft/in_review document\'s fields/body/title (only what you pass changes; everything else keeps its current value), writing a new version. Use this to fix content that publish_document rejected, without losing the document id. Requires an admin/editor project role.',
      inputSchema: {
        id: docId,
        fields: fieldsSchema,
        body: z.string().max(50_000).optional(),
        title: z.string().min(1).max(300).optional(),
      },
      annotations: { title: 'Update document', ...WRITE_ONCE },
    },
    safeTool(async ({ id, fields, body, title }: { id: string; fields?: Record<string, unknown>; body?: string; title?: string }) => {
      const denial = denyRemoteWrite(auth, 'edit_document');
      if (denial) return denial;

      const result = await documents().saveDraftVersion(id, { fields, body, title, createdBy: auth.userId });

      await auth.audit('mcp.update_document', id, {});
      return jsonResult({ ...result });
    }),
  );

  server.registerTool(
    'publish_document',
    {
      title: 'Publish document',
      description:
        'Publishes an in_review document (draft -> published never allowed; request review first via create_document/update_document). version_id and content_hash must match the document\'s current latest version exactly (optimistic concurrency, same contract as the dashboard\'s own publish) -- refetch via get_node if they\'ve drifted. Publishing an SDD/ADR also generates its Work Orders. Requires an admin project role (stronger than edit_document, matching the dashboard\'s own publish gate).',
      inputSchema: { id: docId, version_id: z.string().min(1), content_hash: z.string().min(1) },
      annotations: { title: 'Publish document', ...WRITE_ONCE },
    },
    safeTool(async ({ id, version_id, content_hash }: { id: string; version_id: string; content_hash: string }) => {
      const denial = denyRemoteWrite(auth, 'publish');
      if (denial) return denial;

      const result = await documents().publish(id, { expectedVersionId: version_id, expectedContentHash: content_hash, publishedBy: auth.userId });

      await auth.audit('mcp.publish_document', id, { workOrdersGenerated: result.workOrders?.created ?? 0 });
      return jsonResult({ ...result });
    }),
  );

  registerImpactsPathsDriftTool(server, deps);
}
