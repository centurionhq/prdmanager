/**
 * `validate_document` (SDD-009 §Herramientas): runs the exact same `@prdm/core` `validateDocument` the
 * editor's own live-validation extension (`../../collab/live-validation.ts`) runs after every store, but
 * on demand against the *current* working copy — so the agent can check its own understanding of "is this
 * document currently valid" before proposing an edit, without waiting for the next keystroke-triggered run.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { validateDocument, type DraftKind, type ValidateDocumentMode } from '@prdm/core';
import { projectDoc } from '@prdm/collab';
import { reconstructLiveYDoc } from '../../collab/reconstruct-ydoc.js';
import { resolvePgProjectEngine } from '../../engine/resolve-pg-project-engine.js';
import { buildProjectSettings } from '../../engine/pg-project-settings.js';
import { AgentToolError, AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const MODES: readonly ValidateDocumentMode[] = ['edit', 'publish'];
const inputSchema = z.object({ mode: z.enum(MODES as readonly [ValidateDocumentMode, ...ValidateDocumentMode[]]).optional() });

export const validateDocumentTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'validate_document',
  description: 'Validates the document’s current working copy (frontmatter, lifecycle rules, links) in "edit" mode by default, or "publish" mode to check what would block publishing. Returns a list of issues (severity, code, message, optional field).',
  inputSchema,
  async execute(ctx: AgentToolContext, input) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();
    // WO documents are engine-generated (never collab-authored — SDD-007), so there is no "editing this
    // document's working copy" for the agent to validate in the first place.
    if (ctx.document.kind === 'WO') throw new AgentToolError('not_editable', 'work orders are generated and cannot be validated as a working copy');
    const documentKind: DraftKind = ctx.document.kind;

    const { ydoc } = await reconstructLiveYDoc(ctx.pool, ctx.orgId, ctx.document.id);
    const projection = projectDoc(ydoc);
    // `id`/`type`/`title` are reserved fields `validateDocument` re-injects itself (mirrors
    // ../../collab/live-validation.ts's own destructure) — never forwarded as ordinary frontmatter.
    const { id: _id, type: _type, title: _title, ...fields } = projection.fields;

    const engine = resolvePgProjectEngine(ctx.pool, ctx.neo4j, ctx.orgId, ctx.project);
    const scan = await engine.scan();
    const settings = buildProjectSettings(ctx.project);

    const outcome = validateDocument(
      {
        kind: documentKind,
        title: projection.title,
        fields,
        body: projection.body,
        id: ctx.document.docId,
        mode: input.mode ?? 'edit',
      },
      { scan, grandfathered: settings.lifecycle.grandfathered },
    );

    return { issues: outcome.issues };
  },
};
