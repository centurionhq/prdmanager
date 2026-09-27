/**
 * `propose_edit` (SDD-009 §Diseño: "El agente nunca modifica el documento" — WO-173): the one write-shaped
 * tool, and it never writes to the document at all. It resolves each `expectedText` occurrence in the
 * *current* live body to a `Y.RelativePosition` (via `@prdm/collab`'s `createCommentAnchor` — the exact
 * same anchor mechanism SDD-008's comment threads already use, reused rather than reimplemented), rejects
 * overlapping edits and forbidden frontmatter changes, and stores everything as a `pending`
 * `agent_proposals` row for a human to accept or reject later (WO-174). The anchors are what let the
 * proposal survive concurrent edits elsewhere in the document until then.
 *
 * WO-228: also refuses to create a proposal at all against a document that's frozen against direct human
 * editing too (archived, or `origin: 'generated'`) — see `../../collab/authorize-document.js`'s
 * `isDocumentForcedReadOnly`, the single predicate shared with that enforcement point.
 */
import { z } from 'zod';
import { can } from '@prdm/contracts';
import { assertValidFieldKeys, forbiddenFieldInjectionIssues, type FieldValue } from '@prdm/core';
import { createCommentAnchor, projectDoc } from '@prdm/collab';
import { createTenantDb } from '@prdm/db';
import { isDocumentForcedReadOnly } from '../../collab/authorize-document.js';
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

/**
 * WO-537 (SDD-050/FB-028): matches `@prdm/collab`'s `FrontmatterValue` exactly (`FrontmatterPrimitive |
 * string[]`) — the shape the `Y.Map` this eventually writes to already accepts. It used to be
 * `z.string()` only, which meant the agent had no way to express an array at all: `tags`,
 * `implements`, `architects`, and every other list-shaped field it tried to set got a raw string
 * written where the rest of the system expects `string[]`, caught nowhere until a human opened the
 * frontmatter form and saw "Invalid input: expected array, received string".
 */
const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

const fieldsSchema = z.object({
  set: z.record(z.string(), fieldValueSchema).optional(),
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

/** WO-535 (SDD-049/FB-027): is this `expectedText` nothing a human reviewer could actually see in the
 * proposal's diff? `min(1)` already rejects the empty string, but a lone newline or a run of spaces
 * passes it just as easily and "quotes" nothing visible — the diff's removed side reads as blank. */
function isBlank(expectedText: string): boolean {
  return expectedText.trim() === '';
}

/** The frontmatter keys this project's documents actually use. Matching on the key *name* rather than on
 * the field being present matters: the case where the agent most needs the hint is a document whose
 * working copy is still empty, where no field exists to match against yet. */
const KNOWN_FRONTMATTER_KEYS = new Set([
  'id',
  'type',
  'title',
  'status',
  'tags',
  'created_at',
  'implements',
  'evolves_from',
  'justified_by',
  'informs',
  'architects',
  'provides_context_for',
  'impacts_paths',
  'review_needed',
]);

/** WO-538 (SDD-050/FB-028): the subset of `KNOWN_FRONTMATTER_KEYS` that is really `string[]` under the
 * hood — every `id-list`/`string-list` field in `frontmatter-fields.ts` (the seven relationship fields
 * plus `tags`), and `impacts_paths`, which is Blueprint-only and so isn't in `KNOWN_FRONTMATTER_KEYS`
 * itself. Everything else known (`title`, `status`, `type`, `id`, `created_at`, `review_needed`) is a
 * scalar. */
const KNOWN_LIST_FIELDS = new Set(['tags', 'implements', 'evolves_from', 'justified_by', 'informs', 'architects', 'provides_context_for', 'impacts_paths']);

/** WO-527: is this `expectedText` really a frontmatter line rather than body text? Keyed on a known
 * field name, not on any `word:` prefix — plenty of legitimate body lines start that way ("Nota: ...")
 * and pointing those at `fields` would be worse than the plain not-found they get today. */
function isFrontmatterLine(expectedText: string, currentFields: Record<string, unknown>): boolean {
  const match = /^\s*([A-Za-z_][\w-]*)\s*:/.exec(expectedText);
  if (!match) return false;
  const key = match[1]!;
  return KNOWN_FRONTMATTER_KEYS.has(key) || Object.prototype.hasOwnProperty.call(currentFields, key);
}

export const proposeEditTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'propose_edit',
  description:
    'Proposes one or more precise text replacements and/or frontmatter field changes for a human to review. Two separate paths: "edits" replaces text in the document BODY, and each edit must quote expectedText exactly as it appears there (see read_document); "fields" changes frontmatter (title, tags, justified_by, ...) — frontmatter is never matched by expectedText. This never modifies the document itself.',
  inputSchema,
  async execute(ctx: AgentToolContext, input) {
    const subject = await ctx.loadSubject();
    if (!can(subject, 'use_agent')) throw new AgentToolPermissionError();

    // WO-228 (security review #3, HIGH): mirrors `authorizeCollabDocument`'s own forced-read-only freeze
    // for human live editing — a document a human can't touch directly (archived, or agent-generated
    // `origin`) can't receive a proposal either. Reuses the exact same predicate so the two enforcement
    // points can never drift apart.
    if (isDocumentForcedReadOnly(ctx.document)) {
      throw new AgentToolError('document_read_only', 'this document is archived or generated and cannot receive proposed edits');
    }

    const { ydoc } = await reconstructLiveYDoc(ctx.pool, ctx.orgId, ctx.document.id);
    const projection = projectDoc(ydoc);

    if (input.fields) {
      // WO-538 (SDD-050/FB-028): checked before anything else touches `fields.set` — a known list field
      // sent as a plain string used to be applied as-is, silently writing a value the rest of the system
      // expects as `string[]`. Observed in a real session: `tags` accepted, and the mismatch only ever
      // surfaced later in the frontmatter form, never to the agent that caused it.
      for (const [key, value] of Object.entries(input.fields.set ?? {})) {
        if (KNOWN_LIST_FIELDS.has(key) && typeof value === 'string') {
          throw new AgentToolError(
            'field_type_mismatch',
            `"${key}" is a list field: it must be a JSON array of strings (e.g. ["SDD-001", "SDD-002"]), not a single comma-separated string. Split "${value}" into its own array yourself and send that.`,
          );
        }
      }

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

      // WO-535 (SDD-049/FB-027): observed in a real session — an edit anchored on `"\n"` with a
      // 1228-character replacement landed glued to an existing heading and left the document's own
      // original sections orphaned below it. `accept_agent_proposal` applied it exactly as asked; the
      // proposal itself was the problem, and nothing here stopped it from being created. Blocked before
      // `findOccurrenceRange` even runs, so it never gets to look plausible.
      if (isBlank(edit.expectedText)) {
        throw new AgentToolError(
          'blank_expected_text',
          `expectedText ${JSON.stringify(edit.expectedText)} is empty or only whitespace, so a reviewer could never tell what it quotes. Anchor on real, visible text instead — a heading, a sentence — not a blank line.`,
        );
      }

      const range = findOccurrenceRange(projection.body, edit.expectedText, occurrence);
      if (!range) {
        // WO-527 (SDD-047/FB-026): observed in a real session — the agent tried to edit `title: ""`,
        // i.e. the frontmatter, and got a bare "not found in the body". The confusion is reasonable:
        // this tool *does* change fields, through `fields`, and nothing said so. A dead end became a
        // usable next step.
        //
        // Body and frontmatter deliberately stay separate paths: the body is a `Y.Text` with relative
        // anchors and the frontmatter is a map of fields, and matching `expectedText` against both
        // would break the anchoring that lets a proposal survive concurrent edits.
        const looksLikeFrontmatter = isFrontmatterLine(edit.expectedText, projection.fields as Record<string, unknown>);
        throw new AgentToolError(
          'text_not_found',
          looksLikeFrontmatter
            ? `expectedText ${JSON.stringify(edit.expectedText)} looks like a frontmatter field, and edits only match the document body. Change fields through the "fields" argument instead (e.g. fields.set).`
            : `expectedText ${JSON.stringify(edit.expectedText)} (occurrence ${occurrence}) was not found in the current document body`,
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
