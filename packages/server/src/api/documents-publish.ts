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
 *
 * WO-138: publishing an SDD/ADR also runs `generateWorkOrders` (idempotent — safe even if some work
 * orders already exist from a prior publish of the same blueprint version). A failure there is
 * deliberately *not* a publish failure — the document is already durably published — surfaced instead
 * as `{workOrdersGenerated: false, workOrdersError}` in the response, with
 * `POST .../documents/:docId/generate-work-orders` as an explicit, admin-triggered retry.
 */
import type { DraftKind } from '@prdm/core';
import { can, publishDocumentInputSchema } from '@prdm/contracts';
import { createTenantDb, type DocumentRecord } from '@prdm/db';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import { buildProjectSettings } from '../engine/pg-project-settings.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { generateWorkOrdersFor, isBlueprintKind, publishDocumentVersion } from '../documents/publish.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export { generateWorkOrdersFor, isBlueprintKind, publishedStatus, type WorkOrderGenerationResult } from '../documents/publish.js';

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

function toDocumentSummaryPayload(document: DocumentRecord) {
  return {
    id: document.id,
    docId: document.docId,
    kind: document.kind,
    title: document.title,
    origin: document.origin,
    workflowState: document.workflowState,
    sourcePath: document.sourcePath,
    updatedAt: document.updatedAt.toISOString(),
    publishedVersionId: document.publishedVersionId,
    publishedRaw: document.publishedRaw,
    publishedContentHash: document.publishedContentHash,
  };
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

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const scan = await engine.scan();
      const settings = buildProjectSettings(project);

      const { document: updated, workOrders, contentHash } = await publishDocumentVersion(engine, scan, {
        docId: req.params.docId,
        sourcePath: existing.document.sourcePath,
        kind: existing.document.kind as DraftKind,
        latestVersion: latest,
        expectedVersionId: parsedBody.data.versionId,
        expectedContentHash: parsedBody.data.contentHash,
        publishedBy: session.user.id,
        grandfathered: settings.lifecycle.grandfathered,
      });

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'document.published',
          target: req.params.docId,
          metadata: { versionId: latest.id, contentHash },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { document: toDocumentSummaryPayload(updated), workOrders };
    },
  );

  app.post<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/generate-work-orders',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'publish')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();
      if (existing.document.workflowState !== 'published' || !isBlueprintKind(existing.document.kind)) {
        throw new ConflictError(`${req.params.docId} is not a published SDD/ADR`);
      }

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const workOrders = await generateWorkOrdersFor(engine, req.params.docId);
      if (!workOrders.generated) throw new ConflictError(`could not generate work orders for ${req.params.docId}: ${workOrders.error}`);

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'document.work_orders_generated',
          target: req.params.docId,
          metadata: { created: workOrders.created },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { workOrders };
    },
  );
}
