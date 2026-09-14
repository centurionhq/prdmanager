/**
 * `propose_edit` (SDD-009 §Diseño: "El agente nunca modifica el documento" — WO-173): the one write-shaped
 * tool, and it never writes to the document at all. It resolves each `expectedText` occurrence in the
 * *current* live body to a `Y.RelativePosition` (via `@prdm/collab`'s `createCommentAnchor` — the exact
 * same anchor mechanism SDD-008's comment threads already use, reused rather than reimplemented), rejects
 * overlapping edits and forbidden frontmatter changes, and stores everything as a `pending`
 * `agent_proposals` row for a human to accept or reject later (WO-174). The anchors are what let the
 * proposal survive concurrent edits elsewhere in the document until then.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { assertValidFieldKeys, forbiddenFieldInjectionIssues, type FieldValue } from '@prdm/core';
import { createCommentAnchor, projectDoc } from '@prdm/collab';
import { createTenantDb } from '@prdm/db';
import { reconstructLiveYDoc } from '../../collab/reconstruct-ydoc.js';
import { AgentToolError, AgentToolPermissionError, type AgentToolContext } from './context.js';
import type { AgentTool } from './tool.js';

const MAX_EDITS_PER_PROPOSAL = 20;

const editSchema = z.object({
  /** Matched verbatim (no regex, no fuzzy matching — SDD-009 gives the agent line-numbered `read_document`
   * output precisely so it can quote text exactly) against the current live body. */
  expectedText: z.string().min(1).max(4_000),
  /** 0-indexed occurrence of `expectedText` to target when it appears more than once — defaults to the
   * first (0). */
  occurrence: z.number().int().min(0).optional(),
  replacement: z.string().max(20_000),
});

const fieldsSchema = z.object({
  set: z.record(z.string(), z.string()).optional(),
  unset: z.array(z.string()).optional(),
});

const inputSchema = z.object({
  summary: z.string().min(1).max(2_000),
  edits: z.array(editSchema).min(1).max(MAX_EDITS_PER_PROPOSAL),
  fields: fieldsSchema.optional(),
});

export interface ResolvedProposalEdit {
  expectedText: string;
  occurrence: number;
  replacement: string;
  /** Base64-encoded `Y.encodeRelativePosition(...)` bytes. */
  anchorStart: string;
  anchorEnd: string;
}

interface CharRange {
  from: number;
  to: number;
}

/** Finds the `[from, to)` character range of the `occurrence`-th (0-indexed) match of `needle` in
 * `haystack` — `null` if there are fewer than `occurrence + 1` matches. Plain substring search, not regex
 * (SDD-009: the agent is expected to quote exact text, not patterns). */
function findOccurrenceRange(haystack: string, needle: string, occurrence: number): CharRange | null {
  let searchFrom = 0;
  for (let seen = 0; seen <= occurrence; seen += 1) {
    const index = haystack.indexOf(needle, searchFrom);
    if (index === -1) return null;
    if (seen === occurrence) return { from: index, to: index + needle.length };
    searchFrom = index + 1; // allow overlapping occurrences of the same needle to still be found individually
  }
  return null;
}

function rangesOverlap(a: CharRange, b: CharRange): boolean {
  return a.from < b.to && b.from < a.to;
}

export const proposeEditTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'propose_edit',
  description:
    'Proposes one or more precise text replacements and/or frontmatter field changes for a human to review. Each edit must quote expectedText exactly as it currently appears in the document (see read_document); this never modifies the document itself.',
  inputSchema,
  async execute(ctx: AgentToolContext, input) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'use_agent')) throw new AgentToolPermissionError();

    const { ydoc } = await reconstructLiveYDoc(ctx.pool, ctx.orgId, ctx.document.id);
    const projection = projectDoc(ydoc);

    if (input.fields) {
      try {
        assertValidFieldKeys({ ...(input.fields.set ?? {}), ...Object.fromEntries((input.fields.unset ?? []).map((key) => [key, ''])) });
      } catch (error: unknown) {
        throw new AgentToolError('invalid_field_key', error instanceof Error ? error.message : 'invalid field key');
      }

      const rendered: Record<string, FieldValue> = { ...(projection.fields as Record<string, FieldValue>) };
      for (const [key, value] of Object.entries(input.fields.set ?? {})) rendered[key] = value;
      for (const key of input.fields.unset ?? []) delete rendered[key];

      const issues = forbiddenFieldInjectionIssues(rendered, projection.fields as Record<string, FieldValue>);
      if (issues.length > 0) throw new AgentToolError('forbidden_fields', issues.map((issue) => issue.message).join('; '));
    }

    const claimedRanges: CharRange[] = [];
    const resolvedEdits: ResolvedProposalEdit[] = [];
    for (const edit of input.edits) {
      const occurrence = edit.occurrence ?? 0;
      const range = findOccurrenceRange(projection.body, edit.expectedText, occurrence);
      if (!range) {
        throw new AgentToolError(
          'text_not_found',
          `expectedText ${JSON.stringify(edit.expectedText)} (occurrence ${occurrence}) was not found in the current document body`,
        );
      }
      if (claimedRanges.some((existing) => rangesOverlap(existing, range))) {
        throw new AgentToolError('overlapping_edits', 'two or more edits in this proposal target overlapping text');
      }
      claimedRanges.push(range);

      const anchor = createCommentAnchor(ydoc, range.from, range.to);
      resolvedEdits.push({
        expectedText: edit.expectedText,
        occurrence,
        replacement: edit.replacement,
        anchorStart: Buffer.from(anchor.start).toString('base64'),
        anchorEnd: Buffer.from(anchor.end).toString('base64'),
      });
    }

    const proposal = await createTenantDb(ctx.pool)
      .forOrg(ctx.orgId)
      .agent.proposals.create({
        conversationId: ctx.conversationId,
        documentId: ctx.document.id,
        summary: input.summary,
        edits: resolvedEdits,
        fieldsSet: input.fields?.set ?? null,
        fieldsUnset: input.fields?.unset ?? null,
        requestedBy: ctx.requestedBy,
      });

    return { proposalId: proposal.id, status: proposal.status, summary: proposal.summary, editCount: resolvedEdits.length };
  },
};
