/**
 * `RemoteDocumentsPort` implementation (SDD-020 "Autoria remota de documentos por MCP", WO-421): the
 * narrow surface the remote MCP's `create_document`/`update_document`/`publish_document` tools
 * (`packages/mcp/src/tools-remote-authoring.ts`) are built against, constructed once per
 * `/mcp/:graphProjectId` request in `buildRemoteDeps` (`../api/mcp-remote.ts`) from the already-resolved
 * `PgProjectEngine`/tenant scope.
 *
 * Maps every `@prdm/db` record explicitly onto `@prdm/mcp`'s portable DTO shape (never returns a raw
 * `DocumentRecord`/`DocumentVersionRecord`).
 *
 * Read side (SDD-067, WO-628): `list`/`get` expose unpublished documents with their full body. No
 * permission check here by design — `view` is evaluated in `../api/mcp-remote.ts` before this port is
 * built, and `scope` is already tied to one org+project, so isolation between projects is structural.
 */
import { parseDocument, setFrontmatterFields, sha256, type DraftKind, type FieldValue } from '@prdm/core';
import type { DocumentRecord, DocumentVersionRecord, DocumentWithLatestVersion, ProjectRecord } from '@prdm/db';
import { createTenantDb } from '@prdm/db';
import type { RemoteDocumentDetailVersion, RemoteDocumentSummary, RemoteDocumentVersionSummary, RemoteDocumentWithVersion, RemoteDocumentsPort, RemoteImpactsPathsDrift } from '@prdm/mcp/lib';
import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '../errors.js';
import { computeImpactsPathsDrift, computeImpactsPathsNarrowing } from '../engine/impacts-paths-drift.js';
import type { PgProjectEngine } from '../engine/pg-project-engine.js';
import { buildProjectSettings } from '../engine/pg-project-settings.js';
import { createAndSubmitDocument } from './create-and-submit.js';
import { publishDocumentVersion } from './publish.js';

function toSummary(document: DocumentRecord): RemoteDocumentSummary {
  return { docId: document.docId, kind: document.kind, title: document.title, workflowState: document.workflowState, sourcePath: document.sourcePath };
}

function toVersionSummary(version: DocumentVersionRecord | null): RemoteDocumentVersionSummary | null {
  return version ? { id: version.id, versionNo: version.versionNo, contentHash: version.contentHash } : null;
}

function toDetailVersion(version: DocumentVersionRecord): RemoteDocumentDetailVersion {
  return { id: version.id, versionNo: version.versionNo, contentHash: version.contentHash, renderedMarkdown: version.renderedMarkdown, frontmatter: version.frontmatter as Record<string, unknown> };
}

function toWithVersion({ document, latestVersion }: DocumentWithLatestVersion): RemoteDocumentWithVersion {
  return { document: toSummary(document), latestVersion: toVersionSummary(latestVersion) };
}

const FRONTMATTER_BLOCK = /^---\n[\s\S]*?\n---\n?/;

/** Replaces everything after the frontmatter block, matching `renderDocument`'s own body handling
 * (trimmed, single trailing newline) — used instead of a full `parseDocument`/`renderDocument` round
 * trip so this never requires the document's *current* content to be schema-valid first (a draft/
 * in_review document legitimately can be mid-edit, e.g. a bare SDD template's placeholder `architects:
 * []` fails `blueprintSchema`'s own `.min(1)` outright, well before `checkLifecycle`'s softer warnings
 * ever run). */
function replaceBody(content: string, body: string): string {
  const match = FRONTMATTER_BLOCK.exec(content);
  if (!match) throw new ConflictError('document has no frontmatter block');
  return `${match[0]}\n${body.trim()}\n`;
}

export function buildRemoteDocumentsPort(pool: Pool, orgId: string, project: ProjectRecord, engine: PgProjectEngine): RemoteDocumentsPort {
  const scope = createTenantDb(pool).forOrg(orgId).forProject(project.id);

  return {
    async createAndSubmit(kind, title, createdBy) {
      const created = await createAndSubmitDocument(scope, { kind, title, createdBy, submitForReview: true });
      return toWithVersion(created);
    },

    async list(filter) {
      const documents = await scope.documents.list({ kind: filter?.kind, workflowState: filter?.workflowState });
      return documents.map(toSummary);
    },

    async get(docId) {
      const found = await scope.documents.findByDocId(docId);
      if (!found) return null;
      return { document: toSummary(found.document), latestVersion: found.latestVersion ? toDetailVersion(found.latestVersion) : null };
    },

    async findByDocId(docId) {
      const found = await scope.documents.findByDocId(docId);
      return found ? toWithVersion(found) : null;
    },

    async saveDraftVersion(docId, input) {
      const existing = await scope.documents.findByDocId(docId);
      if (!existing) throw new NotFoundError();
      if (existing.document.workflowState !== 'draft' && existing.document.workflowState !== 'in_review') {
        throw new ConflictError(`${docId} is not editable (currently ${existing.document.workflowState})`);
      }
      const latest = existing.latestVersion;
      if (!latest) throw new ConflictError(`${docId} has no version to update`);

      const fieldsToSet: Record<string, FieldValue> = { ...((input.fields as Record<string, FieldValue> | undefined) ?? {}) };
      if (input.title !== undefined) fieldsToSet.title = input.title;

      let renderedMarkdown = Object.keys(fieldsToSet).length > 0 ? setFrontmatterFields(latest.renderedMarkdown, fieldsToSet) : latest.renderedMarkdown;
      if (input.body !== undefined) renderedMarkdown = replaceBody(renderedMarkdown, input.body);
      const contentHash = sha256(renderedMarkdown);

      // Best-effort snapshot for `document_versions.frontmatter` (display only, e.g. the dashboard's
      // own `DocumentDetail.latestVersion.frontmatter`) -- never authoritative for publish, which always
      // re-parses `renderedMarkdown` itself (`publishDocumentVersion`), so an unparseable intermediate
      // draft (see `replaceBody`'s doc comment) just gets an empty snapshot instead of failing the save.
      const parsedForSnapshot = parseDocument(renderedMarkdown, existing.document.sourcePath);
      const frontmatterSnapshot = parsedForSnapshot?.ok ? (parsedForSnapshot.doc.frontmatter as unknown as Record<string, unknown>) : {};

      const saved = await scope.documents.saveVersion(docId, { renderedMarkdown, frontmatter: frontmatterSnapshot, contentHash, createdBy: input.createdBy });
      if (!saved) throw new ConflictError(`${docId} is no longer editable (currently ${existing.document.workflowState})`);
      return toWithVersion(saved);
    },

    async publish(docId, input) {
      const existing = await scope.documents.findByDocId(docId);
      if (!existing) throw new NotFoundError();
      if (existing.document.workflowState !== 'in_review') {
        throw new ConflictError(`${docId} is not in_review (currently ${existing.document.workflowState})`);
      }
      const latest = existing.latestVersion;
      if (!latest) throw new ConflictError(`${docId} has no version to publish`);

      const scan = await engine.scan();
      const settings = buildProjectSettings(project);

      const result = await publishDocumentVersion(engine, scan, {
        docId,
        sourcePath: existing.document.sourcePath,
        kind: existing.document.kind as DraftKind,
        latestVersion: latest,
        expectedVersionId: input.expectedVersionId,
        expectedContentHash: input.expectedContentHash,
        publishedBy: input.publishedBy,
        grandfathered: settings.lifecycle.grandfathered,
      });

      return { document: toSummary(result.document), workOrders: result.workOrders };
    },

    async getImpactsPathsDrift(blueprintId): Promise<RemoteImpactsPathsDrift | null> {
      const scan = await engine.scan();
      const drift = await computeImpactsPathsDrift(pool, orgId, project.id, scan.docs, blueprintId);
      if (!drift) return null;
      const narrowing = await computeImpactsPathsNarrowing(pool, orgId, project.id, scan.docs, blueprintId);
      return { ...drift, suggestedRemovals: narrowing?.suggestedRemovals ?? [] };
    },
  };
}
