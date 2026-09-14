/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/documents/*` (SDD-007 "Documentos y flujo",
 * WO-136): the human-authored document lifecycle `draft -> in_review -> published -> archived`.
 *
 * Visibility and permission checks reuse `./projects.ts`'s `resolveVisibleProject` (SDD-006 §Aislamiento
 * entre proyectos) exactly like every other project-scoped route family; every mutation beyond
 * visibility is gated through `@prdm/contracts`'s `can` keyed off the caller's effective project role
 * (WO-106's permission matrix: `edit_document`/`request_review` for admin+editor, `archive` admin-only).
 *
 * Archiving refuses (409) when any OTHER published document still links to this one — reusing
 * `@prdm/core`'s `scanContents`/`ParsedDoc.edges` (the same link graph `detectDrift`'s `linkIssues`
 * checks) rather than reimplementing link scanning, over `documents.listPublished()`'s raw content.
 *
 * Publishing (`request_review` -> `published`) is WO-137's job, not this one: creating a document from
 * `templateFor(kind)` and moving `draft -> in_review` is deliberately as far as this WO's server-side
 * writes go.
 */
import { foldersForDocsDir, scanContents, setFrontmatterFields, sha256, slugify, templateFor, todayIso, type TemplateKind } from '@prdm/core';
import { can, createDocumentInputSchema, listDocumentsQuerySchema, type DocumentDetail, type DocumentSummary } from '@prdm/contracts';
import { createTenantDb, type DocumentRecord, type DocumentVersionRecord } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { CollabRevocationHub } from '../collab/revocation.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { captureDocumentVersion } from '../collab/versions.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export interface RegisterDocumentRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  /** SDD-008 §"Servidor de tiempo real" (WO-148): closes every open `/collab` connection to a document
   * the moment it's archived. Optional so every test building this route family without a live
   * Hocuspocus instance keeps working unchanged. */
  collabRevocationHub?: CollabRevocationHub;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

interface DocumentRouteParams extends ProjectRouteParams {
  docId: string;
}

const DOCS_DIR = 'docs';

function toSummary(document: DocumentRecord): DocumentSummary {
  return {
    id: document.id,
    docId: document.docId,
    kind: document.kind,
    title: document.title,
    origin: document.origin,
    workflowState: document.workflowState,
    sourcePath: document.sourcePath,
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toDetail(document: DocumentRecord, latestVersion: DocumentVersionRecord | null): DocumentDetail {
  return {
    ...toSummary(document),
    latestVersion: latestVersion
      ? {
          id: latestVersion.id,
          versionNo: latestVersion.versionNo,
          label: latestVersion.label,
          reason: latestVersion.reason,
          renderedMarkdown: latestVersion.renderedMarkdown,
          frontmatter: latestVersion.frontmatter as Record<string, unknown>,
          contentHash: latestVersion.contentHash,
          contributors: latestVersion.contributors,
          createdAt: latestVersion.createdAt.toISOString(),
        }
      : null,
    publishedVersionId: document.publishedVersionId,
    publishedRaw: document.publishedRaw,
    publishedContentHash: document.publishedContentHash,
    lastValidation: (document.lastValidation as DocumentDetail['lastValidation']) ?? null,
  };
}

/** Every document linking to `targetDocId` from among currently published documents, via
 * `@prdm/core`'s own edge parsing (never a hand-rolled link scan). */
function findPublishedLinkers(published: { sourcePath: string; publishedRaw: string }[], targetDocId: string): string[] {
  const scanned = scanContents(published.map((p) => ({ path: p.sourcePath, content: p.publishedRaw })));
  return scanned.docs.filter((d) => d.edges.some((e) => e.to === targetDocId)).map((d) => d.node.id);
}

export function registerDocumentRoutes(app: FastifyInstance, opts: RegisterDocumentRoutesOptions): void {
  const { auth, pool, env, collabRevocationHub } = opts;

  app.get<{ Params: ProjectRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const parsed = listDocumentsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('invalid query');

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const documents = await scope.documents.list({ kind: parsed.data.kind, workflowState: parsed.data.workflowState });
      return { documents: documents.map(toSummary) };
    },
  );

  app.post<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'edit_document')) throw new ForbiddenError();

      const parsed = createDocumentInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');
      const kind = parsed.data.kind as TemplateKind;
      const title = parsed.data.title;
      const folder = foldersForDocsDir(DOCS_DIR)[kind];

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const { document, latestVersion } = await scope.documents.createDraft({
        kind,
        title,
        createdBy: session.user.id,
        buildContent: (docId) => {
          // WO-217: `type` is substituted here too (previously left untouched from the static template,
          // which hand-writes it unquoted, e.g. `type: PRD`), so `setFrontmatterFields`'s own
          // `JSON.stringify`-based rewrite quotes it exactly like it already does for `id`/`title`/
          // `status`/`created_at` — matching the quoting convention every later version snapshot
          // (`captureDocumentVersion`'s `renderDocument` call) already uses for the very same field.
          // Before this, opening the editor and saving again with *no real edit* produced a spurious
          // `type: PRD` / `type: "PRD"` diff line on the very first save. `setFrontmatterFields` only
          // rewrites the keys it's given and leaves every other template line untouched, so this can't
          // regress SDD/ADR's placeholder-only `architects: []` the way a full schema-validating re-parse
          // of the template would.
          const renderedMarkdown = setFrontmatterFields(templateFor(kind), { id: docId, type: kind, title, status: 'draft', created_at: todayIso() });
          return { sourcePath: `${folder}/${docId}-${slugify(title)}.md`, renderedMarkdown, contentHash: sha256(renderedMarkdown) };
        },
      });

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'document.created',
          target: document.docId,
          metadata: { kind: document.kind },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { document: toDetail(document, latestVersion) };
    },
  );

  app.get<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const found = await scope.documents.findByDocId(req.params.docId);
      if (!found) throw new NotFoundError();

      return { document: toDetail(found.document, found.latestVersion) };
    },
  );

  app.post<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/request-review',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'request_review')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      const updated = await scope.documents.requestReview(req.params.docId);
      if (!updated) throw new ConflictError(`${req.params.docId} is not a draft (currently ${existing.document.workflowState})`);

      // SDD-008 §"Versiones": "automáticas al pedir revisión" — captures the live collab Y.Doc as it
      // stands at this exact transition, never the (possibly stale) `document_versions` row from
      // creation time. Best-effort: a capture failure must never roll back an already-committed
      // workflow transition (the document is genuinely `in_review` either way).
      await captureDocumentVersion(pool, org.id, { documentId: updated.id, reason: 'review_request', createdBy: session.user.id }).catch(() => undefined);

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'document.review_requested',
          target: updated.docId,
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { document: toSummary(updated) };
    },
  );

  app.post<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/archive',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'archive')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();
      if (existing.document.workflowState !== 'published') {
        throw new ConflictError(`${req.params.docId} is not published (currently ${existing.document.workflowState})`);
      }

      const published = await scope.documents.listPublished(req.params.docId);
      const linkers = findPublishedLinkers(published, req.params.docId);
      if (linkers.length > 0) throw new ConflictError(`cannot archive ${req.params.docId}: still linked from ${linkers.join(', ')}`);

      const updated = await scope.documents.archive(req.params.docId);
      if (!updated) throw new ConflictError(`${req.params.docId} is not published (currently ${existing.document.workflowState})`);

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'document.archived',
          target: updated.docId,
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      // SDD-008 (WO-148): "archivar cierra las conexiones afectadas" — an archived document is always
      // read-only (see collab/authorize-document.ts), so closing rather than downgrading in place.
      collabRevocationHub?.revokeDocument(updated.id);

      return { document: toSummary(updated) };
    },
  );
}
