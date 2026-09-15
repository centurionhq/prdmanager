/**
 * `.../documents/:docId/versions*` (SDD-008 §"Versiones", WO-156): manual save-with-label, listing, and
 * a line diff between any two versions. Automatic capture at `request_review` lives in `./documents.js`'s
 * own route (right next to the transition it captures); `publish`'s version row is `PgProjectEngine.
 * publishDocument`'s own job (WO-137, already merged) — this file only ever *reads* that row back.
 */
import { can, createDocumentVersionInputSchema } from '@prdm/contracts';
import { createTenantDb, schema, withTenantTx } from '@prdm/db';
import { diffLines } from '@prdm/collab';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Hocuspocus } from '@hocuspocus/server';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { captureDocumentVersion } from '../collab/versions.js';
import { restoreDocumentVersion, VersionHasNoSnapshotError, VersionNotFoundError } from '../collab/restore.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterDocumentVersionRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  hocuspocus: Hocuspocus;
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

interface ListVersionsQuery {
  limit?: string;
  offset?: string;
}

// WO-225: no pagination shape was already established anywhere else in this codebase (checked before
// inventing one) — a plain limit/offset, capped well below "the whole table", matching the `meta: total,
// page, limit`-shaped envelope this codebase's own API-response convention documents elsewhere.
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function parseListLimit(raw: string | undefined): number {
  const parsed = raw === undefined ? DEFAULT_LIST_LIMIT : Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(parsed, MAX_LIST_LIMIT);
}

function parseListOffset(raw: string | undefined): number {
  const parsed = raw === undefined ? 0 : Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

/** The columns every summary — list or diff — actually needs; deliberately never `yjsState` (WO-225: a
 * full snapshot buffer no summary view has ever rendered — restore.ts fetches it explicitly, by id, only
 * when it's actually about to restore from it). */
type VersionSummaryColumns = Pick<typeof schema.documentVersions.$inferSelect, 'id' | 'versionNo' | 'label' | 'reason' | 'renderedMarkdown' | 'frontmatter' | 'contentHash' | 'contributors' | 'createdAt'>;

function toVersionSummary(version: VersionSummaryColumns) {
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

/** WO-225: the list (summary) view's own shape — everything `toVersionSummary` has except
 * `renderedMarkdown`, which `VersionsPanel` (and every other list consumer) never reads; the list query
 * itself never selects that column in the first place (see the route below). */
type VersionListColumns = Omit<VersionSummaryColumns, 'renderedMarkdown'>;

function toVersionListItem(version: VersionListColumns) {
  return {
    id: version.id,
    versionNo: version.versionNo,
    label: version.label,
    reason: version.reason,
    frontmatter: version.frontmatter as Record<string, unknown>,
    contentHash: version.contentHash,
    contributors: version.contributors,
    createdAt: version.createdAt.toISOString(),
  };
}

export function registerDocumentVersionRoutes(app: FastifyInstance, opts: RegisterDocumentVersionRoutesOptions): void {
  const { auth, pool, env, hocuspocus } = opts;

  app.get<{ Params: DocumentRouteParams; Querystring: ListVersionsQuery }>(
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

      const limit = parseListLimit(req.query.limit);
      const offset = parseListOffset(req.query.offset);

      const { versions, total } = await withTenantTx(pool, org.id, async (tx) => {
        const rows = await tx
          .select({
            id: schema.documentVersions.id,
            versionNo: schema.documentVersions.versionNo,
            label: schema.documentVersions.label,
            reason: schema.documentVersions.reason,
            frontmatter: schema.documentVersions.frontmatter,
            contentHash: schema.documentVersions.contentHash,
            contributors: schema.documentVersions.contributors,
            createdAt: schema.documentVersions.createdAt,
          })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, existing.document.id))
          .orderBy(desc(schema.documentVersions.versionNo))
          .limit(limit)
          .offset(offset);

        const [totalRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, existing.document.id));

        return { versions: rows, total: totalRow?.count ?? 0 };
      });

      return { versions: versions.map(toVersionListItem), total, limit, offset };
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

      // WO-225: fetch exactly the two versions being diffed, by versionNo, rather than every version this
      // document has ever had — still never `yjsState` (the diff below only ever needs `renderedMarkdown`).
      const rows = await withTenantTx(pool, org.id, (tx) =>
        tx
          .select({
            id: schema.documentVersions.id,
            versionNo: schema.documentVersions.versionNo,
            label: schema.documentVersions.label,
            reason: schema.documentVersions.reason,
            renderedMarkdown: schema.documentVersions.renderedMarkdown,
            frontmatter: schema.documentVersions.frontmatter,
            contentHash: schema.documentVersions.contentHash,
            contributors: schema.documentVersions.contributors,
            createdAt: schema.documentVersions.createdAt,
          })
          .from(schema.documentVersions)
          .where(and(eq(schema.documentVersions.documentId, existing.document.id), inArray(schema.documentVersions.versionNo, [versionNo, againstVersionNo]))),
      );
      const from = rows.find((r) => r.versionNo === againstVersionNo);
      const to = rows.find((r) => r.versionNo === versionNo);
      if (!from || !to) throw new NotFoundError();

      return { from: toVersionSummary(from), to: toVersionSummary(to), diff: diffLines(from.renderedMarkdown, to.renderedMarkdown) };
    },
  );

  app.post<{ Params: DocumentVersionRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/versions/:versionNo/restore',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      // `@prdm/contracts`' permission matrix has a dedicated `restore_version` action (same role set as
      // `edit_document` today, but the semantically correct one for this specific route).
      if (!can(subject, 'restore_version')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      const versionNo = Number.parseInt(req.params.versionNo, 10);
      if (!Number.isInteger(versionNo)) throw new ValidationError('versionNo must be an integer');

      try {
        const version = await restoreDocumentVersion(pool, hocuspocus, {
          orgId: org.id,
          projectId: project.id,
          documentId: existing.document.id,
          versionNo,
          restoringUserId: session.user.id,
        });
        return { version: toVersionSummary(version) };
      } catch (err) {
        if (err instanceof VersionNotFoundError) throw new NotFoundError();
        if (err instanceof VersionHasNoSnapshotError) throw new ConflictError(err.message);
        throw err;
      }
    },
  );
}
