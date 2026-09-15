/**
 * `POST /api/v1/projects/:graphProjectId/import` (SDD-010 "Importador", WO-192): the one-time bootstrap
 * that brings a local prdm repository's `docs/`, `.prdm.yaml` and `.prdm/baseline.json` into a brand new
 * remote project. Scope `import:write`, project-admin only. The server re-validates *everything* itself
 * with `@prdm/core`'s real `scanContents`/`parseProjectFile` — nothing the client claims about document
 * validity, ids, kinds or `source_path` shape is ever trusted at face value.
 *
 * IDOR guard: same `resolveProjectByGraphProjectId` + org/`project_ids` check as every other
 * `graphProjectId`-keyed route (governance/code-reports/policy-docs, WO-178/180/183).
 *
 * `project.id` inside the uploaded `.prdm.yaml` is never read for anything — which project this imports
 * into is determined solely by the URL's `graphProjectId` (SDD-010: "ignora el project.id local").
 */
import { assertSafeImportSourcePath, parseBaselineJson, parseProjectFile, scanContents, UnsafeImportSourcePathError, type FolderMap } from '@prdm/core';
import { can, importRequestSchema, MAX_IMPORT_BODY_BYTES, type ImportDocumentDto } from '@prdm/contracts';
import { createTenantDb, findMembership, importDocuments, ProjectNotEmptyError, resolveProjectByGraphProjectId, type ImportDocumentInput } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { isOrgAdmin } from './projects.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';

export interface RegisterImportRoutesOptions {
  pool: Pool;
}

interface ImportRouteParams {
  graphProjectId: string;
}

/** Resolves the caller's effective project role (org owner/admin inherits admin; otherwise their own
 * `project_members` row) — the exact same resolution `mcp-remote.ts` uses for the same reason. */
async function resolveImportSubject(pool: Pool, orgId: string, projectId: string, userId: string) {
  const membership = await findMembership(pool, orgId, userId);
  if (!membership) return null;
  if (isOrgAdmin(membership.role)) return { orgRole: membership.role };
  const projectMembership = await createTenantDb(pool).forOrg(orgId).forProject(projectId).members.findForUser(userId);
  if (!projectMembership) return { orgRole: membership.role };
  return { orgRole: membership.role, projectRole: projectMembership.role };
}

function toImportDocumentInputs(rawDocuments: readonly ImportDocumentDto[], folders: FolderMap): ImportDocumentInput[] {
  const scanned = scanContents(rawDocuments.map((d) => ({ path: d.sourcePath, content: d.content })));
  if (scanned.errors.length > 0) {
    throw new ValidationError(`invalid document(s): ${scanned.errors.map((e) => `${e.path}: ${e.error}`).join('; ')}`);
  }
  if (scanned.docs.length !== rawDocuments.length) {
    // A document that fails to parse (no recognizable frontmatter at all) is silently skipped by
    // `scanContents` itself (it's not an "error", just "not a graph document") — but this endpoint must
    // never silently drop a document the client thought it was importing.
    throw new ValidationError('one or more documents could not be parsed as prdm documents (missing id/type frontmatter)');
  }

  return scanned.docs.map((doc, index) => {
    assertSafeImportSourcePath(doc.node.kind, doc.node.id, folders, doc.node.sourcePath);
    return {
      kind: doc.node.kind,
      docId: doc.node.id,
      title: doc.node.title,
      sourcePath: doc.node.sourcePath,
      // The exact original text, never `doc.node.body` (already normalized/re-derived) — the round-trip
      // property SDD-010 requires depends on storing precisely what the client sent.
      renderedMarkdown: rawDocuments[index]!.content,
      frontmatter: doc.frontmatter as unknown as Record<string, unknown>,
      contentHash: doc.node.contentHash,
    };
  });
}

export function registerImportRoutes(app: FastifyInstance, opts: RegisterImportRoutesOptions): void {
  const { pool } = opts;

  app.post<{ Params: ImportRouteParams }>(
    '/api/v1/projects/:graphProjectId/import',
    { config: { access: { kind: 'bearer', scope: 'import:write' } }, bodyLimit: MAX_IMPORT_BODY_BYTES },
    async (req) => {
      const token = req.token!;
      if (!token.userId) throw new ForbiddenError();

      const resolved = await resolveProjectByGraphProjectId(pool, req.params.graphProjectId);
      if (!resolved || resolved.orgId !== token.orgId) throw new NotFoundError();
      if (token.projectIds && !token.projectIds.includes(resolved.projectId)) throw new NotFoundError();

      // IDOR-safe (SDD-006 §Arquitectura): a resolved membership that merely lacks the `import`
      // permission gets the same 404 as a nonexistent project, never a 403 that would confirm the
      // project exists to someone who isn't its admin — same convention `mcp-remote.ts` uses.
      const subject = await resolveImportSubject(pool, resolved.orgId, resolved.projectId, token.userId);
      if (!subject || !can(subject, 'import')) throw new NotFoundError();

      const parsedBody = importRequestSchema.safeParse(req.body);
      if (!parsedBody.success) throw new ValidationError('invalid import request body');
      const body = parsedBody.data;

      let settings: ReturnType<typeof parseProjectFile>;
      try {
        settings = parseProjectFile(body.prdmYaml);
      } catch (err) {
        throw new ValidationError(`invalid .prdm.yaml: ${err instanceof Error ? err.message : String(err)}`);
      }

      let toImport: ImportDocumentInput[];
      try {
        toImport = toImportDocumentInputs(body.documents, settings.folders);
      } catch (err) {
        if (err instanceof UnsafeImportSourcePathError) throw new ValidationError(err.message);
        throw err;
      }

      let baseline: Record<string, unknown> | undefined;
      if (body.baselineJson !== undefined) {
        try {
          baseline = parseBaselineJson(body.baselineJson) as unknown as Record<string, unknown>;
        } catch (err) {
          throw new ValidationError(`invalid .prdm/baseline.json: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      try {
        const result = await importDocuments(pool, {
          orgId: resolved.orgId,
          projectId: resolved.projectId,
          documents: toImport,
          grandfathered: settings.lifecycle.grandfathered,
          baseline,
        });

        // SDD-010 "Importador": resolved_by, blueprint_hashes and grandfathered are privileged fields
        // normally only ever written by engine operations (WO completion, blueprint-hash reconciliation)
        // or a project admin's own settings — imported verbatim here, so the act of importing them is
        // audited explicitly rather than blending into an ordinary "document created" entry.
        const privilegedWorkOrders = toImport
          .filter((d) => d.kind === 'WO' && hasPrivilegedWorkOrderFields(d.frontmatter))
          .map((d) => d.docId);

        await createTenantDb(pool)
          .forOrg(resolved.orgId)
          .auditLog.record({
            projectId: resolved.projectId,
            actorType: 'user',
            actorId: token.userId,
            action: 'project.imported',
            target: req.params.graphProjectId,
            metadata: {
              documentsImported: result.documents.length,
              importedCommitShas: result.importedCommitShas.length,
              grandfatheredImported: result.grandfatheredImported,
              baselineImported: result.baselineImported,
              privilegedWorkOrders,
            },
            ip: req.ip,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
          });

        return { imported: result.documents.length, documents: result.documents.map((d) => ({ id: d.docId, sourcePath: d.sourcePath })) };
      } catch (err) {
        if (err instanceof ProjectNotEmptyError) throw new ConflictError(err.message);
        throw err;
      }
    },
  );
}

function hasPrivilegedWorkOrderFields(frontmatter: Record<string, unknown>): boolean {
  const resolvedBy = frontmatter.resolved_by;
  const blueprintHashes = frontmatter.blueprint_hashes;
  return (Array.isArray(resolvedBy) && resolvedBy.length > 0) || (typeof blueprintHashes === 'object' && blueprintHashes !== null && Object.keys(blueprintHashes).length > 0);
}
