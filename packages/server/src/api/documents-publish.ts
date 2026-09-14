/**
 * `POST /api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/publish` (SDD-007
 * "Documentos y flujo", WO-137): admin-only, `in_review -> published`.
 *
 * The request sends `{versionId, contentHash}`, which must match the document's actual latest version
 * (SDD-007: "el request envía versionId + content_hash, que deben coincidir con la última versión") —
 * checked twice: once here (a fast, user-facing 409) and again inside `PgProjectEngine.publishDocument`
 * itself under the per-project advisory lock (a narrow data-integrity guard against a concurrent
 * publish racing this one). `@prdm/core`'s `validateDocument` then runs in `'publish'` mode (blocking:
 * every link must resolve, unlike `'edit'` mode's warnings) against the project's currently published
 * documents (`engine.scan()`); any error blocks with 409. `status` is the one field this route manages
 * itself (SDD-007 "status approved/active") — `id`/`type`/`title`/`created_at` are already correct from
 * however the document reached `in_review` (WO-136's draft creation sets them once, up front, so there
 * is nothing left for a *publish*-time id allocation to do in this design).
 */
import { parseDocument, sha256, validateDocument, type DraftKind, type FieldValue } from '@prdm/core';
import { can, publishDocumentInputSchema } from '@prdm/contracts';
import { createTenantDb } from '@prdm/db';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import { buildProjectSettings } from '../engine/pg-project-settings.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export interface RegisterDocumentPublishRouteOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface DocumentRouteParams {
  orgSlug: string;
  projectSlug: string;
  docId: string;
}

/** SDD-007 "status approved/active": a Feature is approved on publish, a Blueprint/Artifact is active;
 * Feedback (human-authored via WO-136, unlike MCP-generated feedback) has no server-managed status of
 * its own and simply keeps whatever it already had. */
function publishedStatus(kind: DraftKind, current: FieldValue | undefined): FieldValue {
  if (kind === 'MRD' || kind === 'PRD' || kind === 'FR') return 'approved';
  if (kind === 'SDD' || kind === 'ADR' || kind === 'ART') return 'active';
  return current ?? 'new';
}

export function registerDocumentPublishRoute(app: FastifyInstance, opts: RegisterDocumentPublishRouteOptions): void {
  const { auth, pool, env } = opts;

  app.post<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/publish',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'publish')) throw new ForbiddenError();

      const parsedBody = publishDocumentInputSchema.safeParse(req.body);
      if (!parsedBody.success) throw new ValidationError('invalid body');

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();
      if (existing.document.workflowState !== 'in_review') {
        throw new ConflictError(`${req.params.docId} is not in_review (currently ${existing.document.workflowState})`);
      }
      const latest = existing.latestVersion;
      if (!latest) throw new ConflictError(`${req.params.docId} has no version to publish`);
      if (latest.id !== parsedBody.data.versionId || latest.contentHash !== parsedBody.data.contentHash) {
        throw new ConflictError(`${req.params.docId} has a newer version than the one being published; reload and try again`);
      }

      const parsedDoc = parseDocument(latest.renderedMarkdown, existing.document.sourcePath);
      if (!parsedDoc?.ok) {
        throw new ConflictError(`cannot publish ${req.params.docId}: content is not valid (${parsedDoc ? parsedDoc.error : 'no frontmatter'})`);
      }

      const kind = existing.document.kind as DraftKind;
      const { id: _id, type: _type, title: _title, ...restFields } = parsedDoc.doc.frontmatter as unknown as Record<string, FieldValue>;
      const fields: Record<string, FieldValue> = { ...restFields, status: publishedStatus(kind, restFields.status) };

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const scan = await engine.scan();
      const settings = buildProjectSettings(project);

      const outcome = validateDocument(
        {
          kind,
          title: parsedDoc.doc.node.title,
          fields,
          body: parsedDoc.doc.node.body,
          id: req.params.docId,
          mode: 'publish',
          baseHash: parsedBody.data.contentHash,
          currentRawHash: latest.contentHash,
        },
        { scan, grandfathered: settings.lifecycle.grandfathered },
      );
      const errors = outcome.issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) throw new ConflictError(`cannot publish ${req.params.docId}: ${errors.map((e) => e.message).join('; ')}`);

      const finalParsed = parseDocument(outcome.rendered, existing.document.sourcePath);
      if (!finalParsed?.ok) throw new ConflictError(`cannot publish ${req.params.docId}: rendered content is invalid (${finalParsed ? finalParsed.error : 'no frontmatter'})`);

      const updated = await engine.publishDocument(req.params.docId, {
        expectedVersionId: latest.id,
        renderedMarkdown: outcome.rendered,
        frontmatter: finalParsed.doc.frontmatter as unknown as Record<string, unknown>,
        publishedBy: session.user.id,
      });

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'document.published',
          target: req.params.docId,
          metadata: { versionId: latest.id, contentHash: sha256(outcome.rendered) },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return {
        document: {
          id: updated.id,
          docId: updated.docId,
          kind: updated.kind,
          title: updated.title,
          origin: updated.origin,
          workflowState: updated.workflowState,
          sourcePath: updated.sourcePath,
          updatedAt: updated.updatedAt.toISOString(),
          publishedVersionId: updated.publishedVersionId,
          publishedRaw: updated.publishedRaw,
          publishedContentHash: updated.publishedContentHash,
        },
      };
    },
  );
}
