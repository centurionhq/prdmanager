/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/{feedback,inbox}` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-339): the HTTP surface for `@prdm/core`'s feedback-ingestion/triage
 * domain functions (`submitFeedback`, `triageText`, `triageFeedback`) already exposed locally by
 * `@prdm/mcp`'s `submit_feedback`/`triage_feedback` tools.
 *
 * `POST .../feedback/:docId/triage` refuses (409 `pending_republish`) when the target is a
 * `collab`-origin document: `triageFeedback`'s own write would only land in `pending_editable_patch`
 * (see `../engine/pg-project-engine.ts`'s `writeGeneratedFields`), invisible everywhere
 * (`scan()`/drift/graph/MCP) until that document is next republished — a triager acting on this endpoint
 * needs the link to take effect now, so this is rejected outright rather than silently deferred.
 */
import { dismissFeedback, markDuplicate, submitFeedback, triageFeedback, triageFeedbackBatch, triageText } from '@prdm/core';
import {
  can,
  DEFAULT_INBOX_LIMIT,
  dismissFeedbackInputSchema,
  inboxQuerySchema,
  markDuplicateInputSchema,
  submitFeedbackInputSchema,
  triageBatchInputSchema,
  type CandidateDto,
  type InboxItemDto,
  type InboxResponseDto,
  type TriageBatchItemResultDto,
} from '@prdm/contracts';
import type { Neo4jGraphDatabase } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import { buildPrdmConfig } from '../engine/pg-project-settings.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export interface RegisterProjectFeedbackRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

interface FeedbackDocRouteParams extends ProjectRouteParams {
  docId: string;
}

const triageInputSchema = z.object({
  informs: z.array(z.string()).optional(),
  root: z.boolean().optional(),
});

export function registerProjectFeedbackRoutes(app: FastifyInstance, opts: RegisterProjectFeedbackRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.post<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'submit_feedback')) throw new ForbiddenError();

      const parsed = submitFeedbackInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const result = await submitFeedback(engine, parsed.data);

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'feedback.submitted',
          target: result.id,
          metadata: { reason: result.reason, linkedTo: result.linkedTo },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result };
    },
  );

  app.get<{ Params: ProjectRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/inbox',
    { config: { access: { kind: 'session' } } },
    async (req): Promise<InboxResponseDto> => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const parsedQuery = inboxQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');
      const { kind, status, source, q, limit = DEFAULT_INBOX_LIMIT, offset = 0 } = parsedQuery.data;
      const needle = q?.toLowerCase();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const scan = await engine.scan();

      const filtered: InboxItemDto[] = scan.docs
        .filter((d) => d.node.label === 'Feedback' || d.node.label === 'Artifact')
        .filter((d) => !kind || d.frontmatter.type === kind)
        .filter((d) => !status || d.node.status === status)
        .filter((d) => !source || ((d.frontmatter.type === 'FB' || d.frontmatter.type === 'ART') && d.frontmatter.source === source))
        .filter((d) => !needle || [d.node.id, d.node.title, d.node.body].some((text) => text.toLowerCase().includes(needle)))
        .map((d) => ({
          id: d.node.id,
          kind: d.frontmatter.type as 'FB' | 'ART',
          title: d.node.title,
          body: d.node.body,
          status: d.node.status,
          source: d.frontmatter.type === 'FB' || d.frontmatter.type === 'ART' ? d.frontmatter.source : 'other',
          links: d.frontmatter.type === 'FB' ? d.frontmatter.informs : d.frontmatter.type === 'ART' ? d.frontmatter.provides_context_for : [],
          receivedAt: d.node.createdAt ?? new Date(0).toISOString(),
          duplicateOf: d.frontmatter.type === 'FB' ? (d.frontmatter.duplicate_of ?? null) : null,
        }))
        // Deterministic order so offset pages never overlap: newest first, id as the tiebreaker.
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));

      return { items: filtered.slice(offset, offset + limit), total: filtered.length };
    },
  );

  app.get<{ Params: FeedbackDocRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/:docId/candidates',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const scan = await engine.scan();
      const doc = scan.docs.find((d) => d.node.id === req.params.docId && (d.node.label === 'Feedback' || d.node.label === 'Artifact'));
      if (!doc) throw new NotFoundError();

      const config = buildPrdmConfig(project);
      const triage = await triageText(engine.store, config, doc.node.body);
      const candidates: CandidateDto[] = triage.candidates.map((c) => ({
        featureId: c.id,
        score: c.score,
        reason: triage.autoLinkTo.includes(c.id) ? triage.reason : 'none',
      }));

      return { mentions: triage.mentions, candidates, autoLinkTo: triage.autoLinkTo, reason: triage.reason, proposal: triage.proposal };
    },
  );

  app.post<{ Params: FeedbackDocRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/:docId/triage',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'edit_document')) throw new ForbiddenError();

      const parsed = triageInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();
      if (existing.document.origin === 'collab') {
        void reply.code(409).send({ error: 'pending_republish', message: `${req.params.docId} has a live working copy; the link will apply once it is republished` });
        return;
      }

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      let result;
      try {
        result = await triageFeedback(engine, req.params.docId, parsed.data);
      } catch (err) {
        throw new ConflictError(err instanceof Error ? err.message : String(err));
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'feedback.triaged',
          target: req.params.docId,
          metadata: { linkedTo: result.linkedTo, root: result.root },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result };
    },
  );

  /** Same collab guard as `/triage`: a `collab` write would only queue in `pending_editable_patch`. `false` once 409 is sent. */
  async function isTriageable(orgId: string, projectId: string, docId: string, reply: FastifyReply): Promise<boolean> {
    const existing = await createTenantDb(pool).forOrg(orgId).forProject(projectId).documents.findByDocId(docId);
    if (!existing) throw new NotFoundError();
    if (existing.document.origin !== 'collab') return true;
    void reply.code(409).send({ error: 'pending_republish', message: `${docId} has a live working copy; the change will apply once it is republished` });
    return false;
  }

  app.post<{ Params: FeedbackDocRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/:docId/dismiss',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'edit_document')) throw new ForbiddenError();

      const parsed = dismissFeedbackInputSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new ValidationError('invalid body');
      if (!(await isTriageable(org.id, project.id, req.params.docId, reply))) return;

      const engine = resolvePgProjectEngine(pool, requireNeo4j(opts.neo4j), org.id, project);
      let result;
      try {
        result = await dismissFeedback(engine, req.params.docId, parsed.data);
      } catch (err) {
        throw new ConflictError(err instanceof Error ? err.message : String(err));
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'feedback.dismissed',
          target: req.params.docId,
          metadata: { reason: parsed.data.reason ?? null },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result };
    },
  );

  app.post<{ Params: FeedbackDocRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/:docId/duplicate',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'edit_document')) throw new ForbiddenError();

      const parsed = markDuplicateInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');
      if (!(await isTriageable(org.id, project.id, req.params.docId, reply))) return;

      const engine = resolvePgProjectEngine(pool, requireNeo4j(opts.neo4j), org.id, project);
      let result;
      try {
        result = await markDuplicate(engine, req.params.docId, parsed.data);
      } catch (err) {
        throw new ConflictError(err instanceof Error ? err.message : String(err));
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'feedback.marked_duplicate',
          target: req.params.docId,
          metadata: { duplicateOf: parsed.data.duplicateOf },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result };
    },
  );

  app.post<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/feedback/triage-batch',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'edit_document')) throw new ForbiddenError();

      const parsed = triageBatchInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');
      const { action, ids } = parsed.data;

      // One listing for the whole batch instead of a lookup per id; `collab` ids never reach core.
      const documents = await createTenantDb(pool).forOrg(org.id).forProject(project.id).documents.list();
      const collabIds = new Set(documents.filter((d) => d.origin === 'collab').map((d) => d.docId));
      const runnableIds = ids.filter((id) => !collabIds.has(id));

      let coreResults: TriageBatchItemResultDto[] = [];
      if (runnableIds.length > 0) {
        const engine = resolvePgProjectEngine(pool, requireNeo4j(opts.neo4j), org.id, project);
        try {
          coreResults = (await triageFeedbackBatch(engine, { ...parsed.data, ids: runnableIds })).results;
        } catch (err) {
          throw new ConflictError(err instanceof Error ? err.message : String(err));
        }
      }

      const byId = new Map(coreResults.map((r) => [r.id, r]));
      const results: TriageBatchItemResultDto[] = [...new Set(ids)].map((id) => byId.get(id) ?? { id, ok: false, error: 'pending_republish' });
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'feedback.triage_batched',
          target: ids.join(','),
          metadata: { action, ok, failed, ids },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result: { action, results, ok, failed } };
    },
  );
}
