/**
 * `.../documents/:docId/versions*` (SDD-008 §"Versiones", WO-156): manual save-with-label, listing, and
 * a line diff between any two versions. Automatic capture at `request_review` lives in `./documents.js`'s
 * own route (right next to the transition it captures); `publish`'s version row is `PgProjectEngine.
 * publishDocument`'s own job (WO-137, already merged) — this file only ever *reads* that row back.
 */
import { can, createDocumentVersionInputSchema } from '@prdm/contracts';
import { createTenantDb, schema, withTenantTx } from '@prdm/db';
import { diffLines } from '@prdm/collab';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { captureDocumentVersion } from '../collab/versions.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterDocumentVersionRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
}

interface DocumentRouteParams {
  orgSlug: string;
  projectSlug: string;
  docId: string;
}

interface DocumentVersionRouteParams extends DocumentRouteParams {
  versionNo: string;
}

interface DiffQuery {
  against: string;
}

function toVersionSummary(version: typeof schema.documentVersions.$inferSelect) {
  return {
    id: version.id,
    versionNo: version.versionNo,
    label: version.label,
    reason: version.reason,
    renderedMarkdown: version.renderedMarkdown,
    frontmatter: version.frontmatter as Record<string, unknown>,
    contentHash: version.contentHash,
    contributors: version.contributors,
    createdAt: version.createdAt.toISOString(),
  };
}

export function registerDocumentVersionRoutes(app: FastifyInstance, opts: RegisterDocumentVersionRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/versions',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      const versions = await withTenantTx(pool, org.id, (tx) => tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, existing.document.id)));
      versions.sort((a, b) => b.versionNo - a.versionNo);

      return { versions: versions.map(toVersionSummary) };
    },
  );

  app.post<{ Params: DocumentRouteParams; Body: unknown }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/versions',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'edit_document')) throw new ForbiddenError();

      const parsed = createDocumentVersionInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      const version = await captureDocumentVersion(pool, org.id, {
        documentId: existing.document.id,
        reason: 'manual',
        label: parsed.data.label,
        createdBy: session.user.id,
      });
      if (!version) throw new ConflictError(`${req.params.docId} has no live collab content yet to save a version of`);

      return { version: toVersionSummary(version) };
    },
  );

  app.get<{ Params: DocumentVersionRouteParams; Querystring: DiffQuery }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/versions/:versionNo/diff',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      const versionNo = Number.parseInt(req.params.versionNo, 10);
      const againstVersionNo = Number.parseInt(req.query.against, 10);
      if (!Number.isInteger(versionNo) || !Number.isInteger(againstVersionNo)) throw new ValidationError('versionNo and against must be integers');

      const rows = await withTenantTx(pool, org.id, (tx) => tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, existing.document.id)));
      const from = rows.find((r) => r.versionNo === againstVersionNo);
      const to = rows.find((r) => r.versionNo === versionNo);
      if (!from || !to) throw new NotFoundError();

      return { from: toVersionSummary(from), to: toVersionSummary(to), diff: diffLines(from.renderedMarkdown, to.renderedMarkdown) };
    },
  );
}
