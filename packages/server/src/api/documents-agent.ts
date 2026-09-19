/**
 * `POST .../documents/:docId/agent/messages` (SDD-009 §Diseño/§Endpoint, WO-172): streams the agent's
 * response to a new chat message via `text/event-stream`, for `editor` or superior (`can(subject,
 * 'use_agent')`), CSRF-protected like every other mutating `/api/app/*` route (the global hook in
 * `../csrf/register-csrf.js`, no per-route opt-in needed).
 *
 * Conversations are private per document+owner (SDD-009: "cada conversación es por documento y visible
 * solo para su dueño") — `findForDocumentAndOwner` scopes strictly to the calling user's own id, so this
 * route can never read or continue another user's conversation even within the same document.
 *
 * One active stream per user (SDD-009 "Una transmisión activa por usuario"): `activeStreamUserIds` is
 * process-wide (this server runs as a single instance, ADR-006), keyed by user id regardless of which
 * document/project the concurrent request targets — a second request from the same user while the first
 * is still streaming gets 409 `conflict`, never silently queued or left to race the first's writes.
 *
 * Abort: `req.raw`'s `'close'` event (fired the instant the client disconnects, per Node's own `http`
 * docs — before Fastify's request lifecycle would otherwise notice) drives an `AbortController` threaded
 * into `runAgentLoop`, so a client giving up mid-stream stops the loop at its next check point rather than
 * leaking a background completion.
 */
import { can } from '@prdm/contracts';
import { sendAgentMessageInputSchema } from '@prdm/contracts';
import { createTenantDb, type AgentMessageRecord, type AgentProposalRecord } from '@prdm/db';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { Hocuspocus } from '@hocuspocus/server';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { DEFAULT_MAX_TOKENS_PER_TURN, runAgentLoop, toolCallSequenceIssues, type AgentLoopEvent, type AgentTranscriptMessage } from '../agent/agent-loop.js';
import { reconcileAgentTokens, reserveAgentTokens, todayUsageDate } from '../agent/agent-quota.js';
import { buildAgentSystemPrompt } from '../agent/system-prompt.js';
import type { LlmClient, LlmMessage, LlmToolCall } from '../agent/llm-client.js';
import { ALL_AGENT_TOOLS, type AgentToolContext } from '../agent/tools/index.js';
import { acceptAgentProposal, ProposalNotFoundError as AcceptProposalNotFoundError, ProposalNotPendingError as AcceptProposalNotPendingError } from '../collab/accept-agent-proposal.js';
import { rejectAgentProposal, ProposalNotFoundError as RejectProposalNotFoundError, ProposalNotPendingError as RejectProposalNotPendingError } from '../collab/reject-agent-proposal.js';
import type { AgentStreamRevocationHub } from '../agent/agent-stream-revocation.js';
import { requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from '../errors.js';
import type { AgentRateLimiter } from '../rate-limit/agent-rate-limits.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterDocumentAgentRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
  /** Omitted entirely disables the agent (mirrors `env.deepseek` being unset) — `main.ts` only passes one
   * when a real DeepSeek key is configured; every test passes a `FakeLlmClient`. */
  llmClient: LlmClient;
  /** Stamped onto every assistant message for persistence (SDD-009 §Persistencia: `agent_messages.model`)
   * — `main.ts` passes `env.deepseek.model ?? DEFAULT_DEEPSEEK_MODEL`; tests pass whatever they like. */
  model?: string;
  /** WO-174: accept applies a proposal as a direct-connection server transaction, same as `../collab/restore.js`. */
  hocuspocus: Hocuspocus;
  /** WO-175: per-user requests-per-minute limit on this route. */
  rateLimiter: AgentRateLimiter;
  /** Test-only: overrides `() => new Date()` so a quota test never depends on which day it actually runs. */
  clock?: () => Date;
  /** WO-253/WO-258: lets a revoked session's stream be aborted instantly, the same way `/collab` already
   * is via `collabRevocationHub`. Optional so every existing test that builds these routes without caring
   * about revocation keeps working unchanged. */
  agentStreamRevocationHub?: AgentStreamRevocationHub;
}

interface ProposalRouteParams extends DocumentRouteParams {
  proposalId: string;
}

function toMessageSummary(message: AgentMessageRecord) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    toolCalls: (message.toolCalls as LlmToolCall[] | null) ?? null,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    model: message.model,
    createdAt: message.createdAt.toISOString(),
  };
}

function toProposalSummary(proposal: AgentProposalRecord) {
  return {
    id: proposal.id,
    conversationId: proposal.conversationId,
    documentId: proposal.documentId,
    status: proposal.status,
    summary: proposal.summary,
    edits: proposal.edits,
    fieldsSet: proposal.fieldsSet,
    fieldsUnset: proposal.fieldsUnset,
    requestedBy: proposal.requestedBy,
    respondedBy: proposal.respondedBy,
    respondedAt: proposal.respondedAt?.toISOString() ?? null,
    createdAt: proposal.createdAt.toISOString(),
  };
}

interface DocumentRouteParams {
  orgSlug: string;
  projectSlug: string;
  docId: string;
}

function toLlmMessage(row: AgentMessageRecord): LlmMessage {
  return {
    role: row.role,
    content: row.content,
    ...(row.toolCalls ? { toolCalls: row.toolCalls as LlmToolCall[] } : {}),
    ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
    ...(row.toolName ? { name: row.toolName } : {}),
  };
}

/** Structurally typed against just the `write` method every real and Fastify-injected `reply.raw` has —
 * avoids importing Node's own `ServerResponse` type just for this one call site.
 *
 * WO-470 (SDD-035/PRD-016): writing to a socket the client already closed throws, and that throw used to
 * escape past the loop and cost the caller the turn's whole transcript. A disconnected reader is the
 * expected end of an SSE stream, not an error: the events simply have nowhere to go, while the turn's
 * output still has somewhere to be persisted. */
function sendSseEvent(raw: { write: (chunk: string) => void; writableEnded?: boolean; destroyed?: boolean }, event: AgentLoopEvent): void {
  if (raw.writableEnded === true || raw.destroyed === true) return;
  try {
    raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  } catch {
    // The reader went away mid-turn. Persistence below is what still matters.
  }
}

/** Node's default `server.requestTimeout` is 5 minutes — verified against the real DeepSeek API (never
 * in CI) to be too short: this account's model runs in "thinking mode" and can take several minutes to
 * produce even a trivial completion's first token. Disables the timeout for this one hijacked SSE
 * response only (never globally), so every other route keeps its slowloris protection.
 *
 * Always passes an explicit no-op callback: Node's real `OutgoingMessage.setTimeout` tolerates omitting
 * it, but Fastify's test-injection mock (`light-my-request`'s `Response.setTimeout`) unconditionally does
 * `this.on('timeout', callback)`, which throws on `undefined` — passing a callback keeps this safe under
 * both a real server and `.inject()`-based tests. */
export function disableRequestTimeout(raw: { setTimeout?: (msecs: number, callback: () => void) => unknown }): void {
  raw.setTimeout?.(0, () => {});
}

export function registerDocumentAgentRoutes(app: FastifyInstance, opts: RegisterDocumentAgentRoutesOptions): void {
  const { auth, pool, env, neo4j, llmClient, model, hocuspocus, rateLimiter, clock = () => new Date(), agentStreamRevocationHub } = opts;
  const activeStreamUserIds = new Set<string>();

  // WO-176: lets the chat panel restore the caller's own conversation (transcript + proposals) on mount,
  // rather than losing it on every page refresh — same "private per document+owner" scope as the POST
  // below, and the same use_agent gate (viewing your own agent conversation needs the same permission as
  // starting one).
  app.get<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/agent/conversation',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'use_agent')) throw new ForbiddenError();

      const tenantDb = createTenantDb(pool).forOrg(org.id);
      const existing = await tenantDb.forProject(project.id).documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      const conversation = await tenantDb.agent.conversations.findForDocumentAndOwner(existing.document.id, session.user.id);
      if (!conversation) return { conversationId: null, messages: [], proposals: [] };

      const [messages, proposals] = await Promise.all([
        tenantDb.agent.messages.listForConversation(conversation.id),
        tenantDb.agent.proposals.listForConversation(conversation.id),
      ]);
      return { conversationId: conversation.id, messages: messages.map(toMessageSummary), proposals: proposals.map(toProposalSummary) };
    },
  );

  app.post<{ Params: DocumentRouteParams; Body: unknown }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/agent/messages',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const userId = session.user.id;

      const org = await requireMemberOrg(pool, req.params.orgSlug, userId);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, userId);
      if (!can(subject, 'use_agent')) throw new ForbiddenError();

      const parsed = sendAgentMessageInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');

      // SDD-009 §Seguridad y costo: rate limit and quota are both checked, and sanitized on failure —
      // neither the rate-limit nor the quota-exceeded response ever says which limit was hit or how much
      // capacity remains beyond the standard Retry-After header a rate limiter already exposes.
      const rateLimit = await rateLimiter.check(req, userId);
      if (!rateLimit.allowed) {
        void reply.header('retry-after', String(rateLimit.retryAfterSeconds));
        throw new RateLimitedError();
      }

      const tenantDb = createTenantDb(pool).forOrg(org.id);
      const existing = await tenantDb.forProject(project.id).documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      if (activeStreamUserIds.has(userId)) throw new ConflictError('an agent conversation is already streaming for this user');
      activeStreamUserIds.add(userId);

      // Declared outside the `try` below (not `const` inside it) so `finally` — a separate block scope —
      // can still reach it to unregister from `agentStreamRevocationHub`; `undefined` covers the early-throw
      // paths above `new AbortController()` that this `finally` also runs for.
      let controller: AbortController | undefined;
      try {
        // Reserved *before* the model is ever called (SDD-009 "reserva de tokens antes de llamar (los
        // turnos concurrentes no exceden la cuota)") — see agent-quota.ts's own module doc comment for why
        // this is safe under concurrent requests. Reconciled once the turn actually finishes, below.
        const usageDate = todayUsageDate(clock);
        const reservationTokens = DEFAULT_MAX_TOKENS_PER_TURN;
        const reservation = await reserveAgentTokens(pool, org.id, reservationTokens, env.agentQuotas, usageDate);
        if (!reservation.ok) throw new RateLimitedError();

        const conversation =
          (await tenantDb.agent.conversations.findForDocumentAndOwner(existing.document.id, userId)) ??
          (await tenantDb.agent.conversations.create({ documentId: existing.document.id, ownerId: userId }));

        const priorMessages = await tenantDb.agent.messages.listForConversation(conversation.id);
        await tenantDb.agent.messages.append({ conversationId: conversation.id, role: 'user', content: parsed.data.message });

        const messages: LlmMessage[] = [
          { role: 'system', content: buildAgentSystemPrompt() },
          ...priorMessages.map(toLlmMessage),
          { role: 'user', content: parsed.data.message },
        ];

        // WO-471 (SDD-035/PRD-016): the replayed history is where the ordering bug actually hurt -- a
        // `tool` message ahead of the `assistant` that requested it is rejected by the provider, and it
        // was produced by the *read*, not the write, so no amount of care at persistence time would have
        // caught it. Logged rather than thrown: refusing to answer would turn a recoverable history
        // defect into an outage, and this is the signal that says a conversation went bad and where.
        const sequenceIssues = toolCallSequenceIssues(messages);
        if (sequenceIssues.length > 0) req.log.warn({ conversationId: conversation.id, issues: sequenceIssues }, 'replayed agent history violates the tool-call sequence invariant');

        const toolCtx: AgentToolContext = {
          pool,
          neo4j: requireNeo4j(neo4j),
          orgId: org.id,
          project,
          document: existing.document,
          conversationId: conversation.id,
          requestedBy: userId,
          // Re-resolved on every tool call (SDD-009 "re-leídos en cada llamada") — a role change or
          // removal mid-conversation takes effect on the very next tool call, not only at the next request.
          loadSubject: async () => {
            const freshOrg = await requireMemberOrg(pool, req.params.orgSlug, userId);
            return (await resolveVisibleProject(pool, freshOrg, req.params.projectSlug, userId)).subject;
          },
        };

        controller = new AbortController();
        req.raw.on('close', () => controller?.abort());
        // WO-253/WO-258: registered before the loop starts, unregistered in `finally` below — the same
        // controller a client disconnect already aborts, now also reachable from a session revocation
        // that lands mid-turn (see `agent-stream-revocation.ts`'s own doc comment for why `/collab`'s
        // existing revocation hub doesn't cover this route).
        agentStreamRevocationHub?.register(userId, controller);

        reply.hijack();
        disableRequestTimeout(reply.raw);
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });

        // WO-470 (SDD-035/PRD-016): the loop no longer throws -- it returns what it produced plus a
        // `finishReason`, so an aborted or failed turn persists its partial transcript instead of
        // vanishing. This `catch` is now only for something going wrong *outside* the loop's own
        // handling, and it still keeps whatever was already collected.
        const loop = runAgentLoop({ llmClient, tools: ALL_AGENT_TOOLS, toolCtx, messages, model, maxTokensPerTurn: reservationTokens, signal: controller.signal });
        let newMessages: AgentTranscriptMessage[] = [];
        try {
          let step = await loop.next();
          while (!step.done) {
            sendSseEvent(reply.raw, step.value);
            step = await loop.next();
          }
          newMessages = step.value.newMessages;
        } catch (error: unknown) {
          req.log.error({ err: error }, 'agent loop failed unexpectedly');
          sendSseEvent(reply.raw, { type: 'error', code: 'llm_error', message: 'the agent failed unexpectedly' });
        }

        const actualTokens = newMessages.reduce((sum, message) => sum + (message.usage?.totalTokens ?? 0), 0);
        await reconcileAgentTokens(pool, org.id, reservationTokens, actualTokens, usageDate);

        // WO-256: one batched insert instead of one `append` per message.
        await tenantDb.agent.messages.appendMany(
          newMessages.map((message) => ({
            conversationId: conversation.id,
            role: message.role,
            content: message.content,
            toolCalls: message.toolCalls ?? null,
            toolCallId: message.toolCallId ?? null,
            toolName: message.name ?? null,
            promptTokens: message.usage?.promptTokens ?? null,
            completionTokens: message.usage?.completionTokens ?? null,
            totalTokens: message.usage?.totalTokens ?? null,
            model: message.model ?? null,
          })),
        );
        await tenantDb.agent.conversations.touch(conversation.id);

        reply.raw.end();
      } finally {
        activeStreamUserIds.delete(userId);
        if (controller) agentStreamRevocationHub?.unregister(userId, controller);
      }
    },
  );

  app.post<{ Params: ProposalRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/agent/proposals/:proposalId/accept',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'accept_agent_proposal')) throw new ForbiddenError();

      const existing = await createTenantDb(pool).forOrg(org.id).forProject(project.id).documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      try {
        const result = await acceptAgentProposal(pool, hocuspocus, {
          orgId: org.id,
          projectId: project.id,
          documentId: existing.document.id,
          proposalId: req.params.proposalId,
          acceptingUserId: session.user.id,
        });
        if (result.status === 'stale') return { status: 'stale' as const };
        const proposal = await createTenantDb(pool).forOrg(org.id).agent.proposals.findById(req.params.proposalId);
        return { status: 'accepted' as const, proposal: proposal ? toProposalSummary(proposal) : null, versionNo: result.version?.versionNo ?? null };
      } catch (error: unknown) {
        if (error instanceof AcceptProposalNotFoundError) throw new NotFoundError();
        if (error instanceof AcceptProposalNotPendingError) throw new ConflictError('this proposal has already been decided');
        throw error;
      }
    },
  );

  app.post<{ Params: ProposalRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/agent/proposals/:proposalId/reject',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'accept_agent_proposal')) throw new ForbiddenError();

      const existing = await createTenantDb(pool).forOrg(org.id).forProject(project.id).documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      try {
        const proposal = await rejectAgentProposal(pool, { orgId: org.id, documentId: existing.document.id, proposalId: req.params.proposalId, rejectingUserId: session.user.id });
        return { status: 'rejected' as const, proposal: toProposalSummary(proposal) };
      } catch (error: unknown) {
        if (error instanceof RejectProposalNotFoundError) throw new NotFoundError();
        if (error instanceof RejectProposalNotPendingError) throw new ConflictError('this proposal has already been decided');
        throw error;
      }
    },
  );
}
