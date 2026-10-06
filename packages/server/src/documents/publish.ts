/**
 * Shared publish logic (SDD-020 "Autoria remota de documentos por MCP", WO-420): extracted from
 * `../api/documents-publish.ts`'s `POST .../documents/:docId/publish` route so the exact same
 * validate-then-write sequence is reachable from both the session-authenticated REST route and the new
 * remote MCP `publish_document` tool (`tools-remote-authoring.ts`).
 *
 * Deliberately does no audit logging, permission checking, or existence/workflow-state lookup of its
 * own — those stay in each caller (they need the document row anyway, to build their own 404/409
 * messages), and are passed in here as `existing`/`latestVersion` so this function never has to guess
 * which repository the caller is using.
 */
import { generateWorkOrders, parseDocument, sha256, validateDocument, type DraftKind, type FieldValue, type GrandfatheredDoc, type ProjectEngine, type ScanResult } from '@prdm/core';
import type { DocumentRecord, DocumentVersionRecord } from '@prdm/db';
import { ConflictError } from '../errors.js';
import type { PgProjectEngine } from '../engine/pg-project-engine.js';

/** SDD-007 "status approved/active": a Feature is approved on publish -- a Business Case included, since it
 * is label `Feature` too (SDD-022; without it a published BC keeps the `draft` it was created with and never
 * counts as an initiative) -- a Blueprint/Artifact is active;
 * Feedback (human-authored via WO-136, unlike MCP-generated feedback) has no server-managed status of
 * its own and simply keeps whatever it already had. */
export function publishedStatus(kind: DraftKind, current: FieldValue | undefined): FieldValue {
  if (kind === 'MRD' || kind === 'PRD' || kind === 'FR' || kind === 'BC') return 'approved';
  if (kind === 'SDD' || kind === 'ADR' || kind === 'ART') return 'active';
  return current ?? 'new';
}

export function isBlueprintKind(kind: string): kind is 'SDD' | 'ADR' {
  return kind === 'SDD' || kind === 'ADR';
}

export interface WorkOrderGenerationResult {
  generated: boolean;
  created: number;
  error?: string;
}

/** WO-138: idempotent (safe to call repeatedly — `generateWorkOrders` itself skips tasks already
 * generated, keyed by `source_task`) and never throws — a failure is reported, never propagated, so a
 * caller (publish, or the manual retry route) can always still respond successfully about the document
 * itself. */
export async function generateWorkOrdersFor(engine: ProjectEngine, docId: string): Promise<WorkOrderGenerationResult> {
  try {
    const result = await generateWorkOrders(engine, docId);
    return { generated: true, created: result.created.length };
  } catch (err) {
    return { generated: false, created: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PublishDocumentVersionInput {
  docId: string;
  sourcePath: string;
  kind: DraftKind;
  latestVersion: DocumentVersionRecord;
  expectedVersionId: string;
  expectedContentHash: string;
  publishedBy: string;
  grandfathered: readonly GrandfatheredDoc[];
}

export interface PublishDocumentVersionResult {
  document: DocumentRecord;
  workOrders?: WorkOrderGenerationResult;
  /** Sha256 of the final rendered/published content — callers use this for audit logging instead of
   * re-hashing `document.publishedRaw` themselves (which is typed nullable at the DB-record level even
   * though it is always set immediately after a successful publish). */
  contentHash: string;
}

/**
 * The request must send `{versionId, contentHash}` matching the document's actual latest version —
 * checked here (a 409) and again inside `PgProjectEngine.publishDocument` itself under the per-project
 * advisory lock (a narrow data-integrity guard against a concurrent publish racing this one).
 * `@prdm/core`'s `validateDocument` then runs in `'publish'` mode (blocking: every link must resolve,
 * unlike `'edit'` mode's warnings) against the project's currently published documents (`engine.scan()`).
 *
 * Publishing an SDD/ADR also runs `generateWorkOrdersFor` (WO-138) — a failure there is deliberately
 * *not* a publish failure, since the document is already durably published by that point.
 */
export async function publishDocumentVersion(engine: PgProjectEngine, scan: ScanResult, input: PublishDocumentVersionInput): Promise<PublishDocumentVersionResult> {
  if (input.latestVersion.id !== input.expectedVersionId || input.latestVersion.contentHash !== input.expectedContentHash) {
    throw new ConflictError(`${input.docId} has a newer version than the one being published; reload and try again`);
  }

  const parsedDoc = parseDocument(input.latestVersion.renderedMarkdown, input.sourcePath);
  if (!parsedDoc?.ok) {
    throw new ConflictError(`cannot publish ${input.docId}: content is not valid (${parsedDoc ? parsedDoc.error : 'no frontmatter'})`);
  }

  const { id: _id, type: _type, title: _title, ...restFields } = parsedDoc.doc.frontmatter as unknown as Record<string, FieldValue>;
  const fields: Record<string, FieldValue> = { ...restFields, status: publishedStatus(input.kind, restFields.status) };

  const outcome = validateDocument(
    {
      kind: input.kind,
      title: parsedDoc.doc.node.title,
      fields,
      body: parsedDoc.doc.node.body,
      id: input.docId,
      mode: 'publish',
      baseHash: input.expectedContentHash,
      currentRawHash: input.latestVersion.contentHash,
    },
    { scan, grandfathered: input.grandfathered },
  );
  const errors = outcome.issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) throw new ConflictError(`cannot publish ${input.docId}: ${errors.map((e) => e.message).join('; ')}`);

  const finalParsed = parseDocument(outcome.rendered, input.sourcePath);
  if (!finalParsed?.ok) throw new ConflictError(`cannot publish ${input.docId}: rendered content is invalid (${finalParsed ? finalParsed.error : 'no frontmatter'})`);

  const updated = await engine.publishDocument(input.docId, {
    expectedVersionId: input.latestVersion.id,
    renderedMarkdown: outcome.rendered,
    frontmatter: finalParsed.doc.frontmatter as unknown as Record<string, unknown>,
    publishedBy: input.publishedBy,
  });

  const workOrders = isBlueprintKind(updated.kind) ? await generateWorkOrdersFor(engine, input.docId) : undefined;

  return { document: updated, workOrders, contentHash: sha256(outcome.rendered) };
}
