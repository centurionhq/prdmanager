/**
 * `get_template` (SDD-009 §Herramientas): the blank Markdown template for a document kind — plain static
 * content (`@prdm/core`'s own `templateFor`), never touches the project/database at all. Still gated on
 * `view` for consistency with every other tool ("atadas ... a los permisos de quien pregunta").
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { DRAFT_KINDS, templateFor, type TemplateKind } from '@prdm/core';
import { AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const inputSchema = z.object({ kind: z.enum(DRAFT_KINDS as readonly [TemplateKind, ...TemplateKind[]]) });

export const getTemplateTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'get_template',
  description: 'Returns the blank Markdown template (frontmatter + section skeleton) for a document kind (MRD, PRD, FR, SDD, ADR, ART or FB).',
  inputSchema,
  async execute(ctx: AgentToolContext, input) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'view')) throw new AgentToolPermissionError();
    return { kind: input.kind, template: templateFor(input.kind) };
  },
};
