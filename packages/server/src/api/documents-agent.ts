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
import { createTenantDb, type AgentMessageRecord } from '@prdm/db';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { runAgentLoop, type AgentLoopEvent, type AgentTranscriptMessage } from '../agent/agent-loop.js';
import { buildAgentSystemPrompt } from '../agent/system-prompt.js';
import type { LlmClient, LlmMessage, LlmToolCall } from '../agent/llm-client.js';
import { ALL_AGENT_TOOLS, type AgentToolContext } from '../agent/tools/index.js';
import { requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
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
 * avoids importing Node's own `ServerResponse` type just for this one call site. */
function sendSseEvent(raw: { write: (chunk: string) => void }, event: AgentLoopEvent): void {
  raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function registerDocumentAgentRoutes(app: FastifyInstance, opts: RegisterDocumentAgentRoutesOptions): void {
  const { auth, pool, env, neo4j, llmClient, model } = opts;
  const activeStreamUserIds = new Set<string>();

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

      const tenantDb = createTenantDb(pool).forOrg(org.id);
      const existing = await tenantDb.forProject(project.id).documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      if (activeStreamUserIds.has(userId)) throw new ConflictError('an agent conversation is already streaming for this user');
      activeStreamUserIds.add(userId);

      try {
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

        const controller = new AbortController();
        req.raw.on('close', () => controller.abort());

        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });

        let newMessages: AgentTranscriptMessage[] = [];
        try {
          const loop = runAgentLoop({ llmClient, tools: ALL_AGENT_TOOLS, toolCtx, messages, model, signal: controller.signal });
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

        for (const message of newMessages) {
          await tenantDb.agent.messages.append({
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
          });
        }
        await tenantDb.agent.conversations.touch(conversation.id);

        reply.raw.end();
      } finally {
        activeStreamUserIds.delete(userId);
      }
    },
  );
}
