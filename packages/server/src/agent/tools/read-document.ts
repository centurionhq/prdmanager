/**
 * `read_document` (SDD-009 §Herramientas): "copia de trabajo con números de línea" — the *live* Yjs
 * working copy (never the last-published snapshot), so the agent always reasons about exactly what a
 * concurrent human editor currently sees, numbered so `propose_edit` (WO-173) and a human reviewer can
 * both refer to "line 12" unambiguously.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { projectDoc } from '@prdm/collab';
import { reconstructLiveYDoc } from '../../collab/reconstruct-ydoc.js';
import { AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const inputSchema = z.object({});

function numberLines(body: string): string {
  if (body.length === 0) return '(empty document)';
  return body
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
}

export const readDocumentTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'read_document',
  description: "Reads the document's current working copy (frontmatter fields and body), with 1-indexed line numbers on every body line.",
  inputSchema,
  async execute(ctx: AgentToolContext) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();

    const { ydoc } = await reconstructLiveYDoc(ctx.pool, ctx.orgId, ctx.document.id);
    const projection = projectDoc(ydoc);
    return { fields: projection.fields, body: numberLines(projection.body) };
  },
};
