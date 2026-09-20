/**
 * Shared draft-creation logic (SDD-020 "Autoria remota de documentos por MCP", WO-420): extracted from
 * `../api/documents.ts`'s `POST .../documents` route so the same DB-write sequence is reachable from
 * both the session-authenticated REST route (unchanged behavior: creates a `draft`, never auto-submits)
 * and the new remote MCP `create_document` tool (which *does* also submit for review in the same call,
 * since MCP has no separate "click Request Review" step — see `tools-remote-authoring.ts`).
 *
 * Deliberately does no audit logging or permission checking of its own: those stay in each caller
 * (REST route vs. MCP tool), since the audit actor/context (session user + ip/userAgent vs. an MCP
 * token's own audit helper) differs between them.
 */
import { assertValidFieldKeys, foldersForDocsDir, forbiddenFieldIssues, setFrontmatterFields, sha256, slugify, templateFor, todayIso, type FieldValue, type TemplateKind } from '@prdm/core';
import type { DocumentsRepository, DocumentWithLatestVersion } from '@prdm/db';

export const DOCS_DIR = 'docs';

export interface CreateAndSubmitDocumentInput {
  kind: TemplateKind;
  title: string;
  createdBy: string;
  /** `true` immediately transitions the freshly created draft to `in_review` (MCP's `create_document`);
   * `false` leaves it as `draft` (the existing REST `POST .../documents` route's own behavior). */
  submitForReview: boolean;
  /** SDD-052: frontmatter seeded into the *first* version, so a document can be born already chained
   * (`justified_by`) instead of being written and then patched by a second version. Never trusted as-is: the
   * server-managed fields below are written after it so they always win, and it is re-checked here even
   * though the REST contract's allowlist already narrows it. */
  fields?: Record<string, FieldValue>;
}

/**
 * `createDraft` (WO-217's quoting-safe `setFrontmatterFields` substitution) followed, when requested,
 * by `requestReview` in the same call. A `requestReview` failure right after a fresh `createDraft`
 * would mean the guarded `workflow_state = 'draft'` precondition somehow didn't hold on a document this
 * function itself just created — genuinely unexpected, so it throws rather than silently returning the
 * still-draft document.
 */
export async function createAndSubmitDocument(scope: { documents: DocumentsRepository }, input: CreateAndSubmitDocumentInput): Promise<DocumentWithLatestVersion> {
  const folder = foldersForDocsDir(DOCS_DIR)[input.kind];
  const seeded = input.fields ?? {};
  assertValidFieldKeys(seeded);
  const forbidden = forbiddenFieldIssues(seeded);
  if (forbidden.length > 0) throw new Error(forbidden.map((issue) => issue.message).join('; '));

  const created = await scope.documents.createDraft({
    kind: input.kind,
    title: input.title,
    createdBy: input.createdBy,
    buildContent: (docId) => {
      const renderedMarkdown = setFrontmatterFields(templateFor(input.kind), { ...seeded, id: docId, type: input.kind, title: input.title, status: 'draft', created_at: todayIso() });
      return { sourcePath: `${folder}/${docId}-${slugify(input.title)}.md`, renderedMarkdown, contentHash: sha256(renderedMarkdown) };
    },
  });

  if (!input.submitForReview) return created;

  const submitted = await scope.documents.requestReview(created.document.docId);
  if (!submitted) throw new Error(`failed to submit ${created.document.docId} for review immediately after creating it`);
  return { document: submitted, latestVersion: created.latestVersion };
}
