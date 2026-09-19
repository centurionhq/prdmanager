/**
 * `.../documents/:docId/agent/{messages,proposals/:id/{accept,reject}}` (SDD-009, WO-172/173/174/176).
 *
 * `sendAgentMessage` can't go through `./request.ts`'s `request<T>()` (that always reads the *whole* body
 * as one JSON value) — the response is `text/event-stream`, read incrementally frame by frame as the
 * agent streams. `AgentSseEvent` mirrors `packages/server/src/agent/agent-loop.ts`'s `AgentLoopEvent`
 * wire shape exactly (duplicated rather than shared: `packages/app` never depends on `packages/server`,
 * SDD-006 §Arquitectura's one-way dependency graph).
 */
import { ApiClientError } from './api-client-error.js';
import { buildFetchInit, request } from './request.js';

export interface AgentToolCallDto {
  id: string;
  name: string;
  argumentsJson: string;
}

/** Why a turn stopped. Mirrors the server's `AgentLoopFinishReason`; `'error'` (WO-470) and
 * `'truncated'` (WO-489) were added there while this mirror silently lagged behind — harmless only for
 * as long as nobody read `done`, which WO-499 now does. */
export type AgentFinishReason = 'stop' | 'max_iterations' | 'token_budget_exceeded' | 'aborted' | 'error' | 'truncated';

export type AgentSseEvent =
  | { type: 'message_start' }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; toolCall: AgentToolCallDto }
  | { type: 'tool_result'; toolCall: AgentToolCallDto; resultJson: string; ok: boolean }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'done'; finishReason: AgentFinishReason }
  /** WO-491: the server saying "still here" while the model thinks, with how long the turn has been
   * running. The elapsed time is the server's, never a client-side stopwatch that would keep counting
   * against a server that had already died. */
  | { type: 'heartbeat'; elapsedMs: number }
  | { type: 'error'; code: string; message: string };

export interface AgentProposalEditDto {
  expectedText: string;
  occurrence: number;
  replacement: string;
}

export interface AgentProposalDto {
  id: string;
  conversationId: string;
  documentId: string;
  status: 'pending' | 'accepted' | 'rejected' | 'stale';
  summary: string;
  edits: AgentProposalEditDto[];
  fieldsSet: Record<string, string> | null;
  fieldsUnset: string[] | null;
  requestedBy: string;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface AgentMessageDto {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: AgentToolCallDto[] | null;
  toolCallId: string | null;
  toolName: string | null;
  model: string | null;
  /** WO-492: only on a `role: 'tool'` message — whether that call succeeded. */
  toolOk: boolean | null;
  /** WO-493: only on a turn's last message — how that turn ended. */
  finishReason: AgentFinishReason | null;
  createdAt: string;
}

export interface AgentConversationDto {
  conversationId: string | null;
  messages: AgentMessageDto[];
  proposals: AgentProposalDto[];
}

function agentBase(orgSlug: string, projectSlug: string, docId: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/documents/${encodeURIComponent(docId)}/agent`;
}

interface AppErrorBody {
  error: { code: string; message: string };
}

function isAppErrorBody(body: unknown): body is AppErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const { error } = body as { error: unknown };
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}

/** Parses complete `event: X\ndata: Y\n\n` frames out of `buffer`, returning the leftover partial tail so
 * the caller can keep accumulating it across `reader.read()` chunks (a frame boundary is never guaranteed
 * to land on a single chunk). */
function drainSseFrames(buffer: string, onEvent: (event: AgentSseEvent) => void): string {
  let rest = buffer;
  let separatorIndex: number;
  while ((separatorIndex = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, separatorIndex);
    rest = rest.slice(separatorIndex + 2);
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) continue;
    try {
      onEvent(JSON.parse(dataLine.slice('data: '.length)) as AgentSseEvent);
    } catch {
      // A malformed frame is dropped rather than crashing the whole stream — the model/server misbehaving
      // on one event is not a reason to stop rendering the rest of the conversation.
    }
  }
  return rest;
}

/** Streams one chat turn, invoking `onEvent` for every SSE frame as it arrives. Resolves once the stream
 * ends (normally or via `signal` aborting it) — never buffers the whole response before the caller sees
 * anything, which is the entire point of streaming the reply token by token in the UI. */
export async function sendAgentMessage(orgSlug: string, projectSlug: string, docId: string, message: string, onEvent: (event: AgentSseEvent) => void, signal?: AbortSignal): Promise<void> {
  const path = `${agentBase(orgSlug, projectSlug, docId)}/messages`;
  const init = await buildFetchInit(path, { method: 'POST', body: { message } }, true);
  const response = await fetch(path, { ...init, signal });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // no body to parse — falls through to the generic error below.
    }
    if (isAppErrorBody(body)) throw new ApiClientError(response.status, body.error.code as ApiClientError['code'], body.error.message);
    throw new ApiClientError(response.status, 'unknown', `agent request failed with status ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ApiClientError(response.status, 'unknown', 'the agent response had no readable stream body');

  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = drainSseFrames(buffer + decoder.decode(value, { stream: true }), onEvent);
  }
}

export type AcceptAgentProposalResult = { status: 'accepted'; proposal: AgentProposalDto | null; versionNo: number | null } | { status: 'stale' };

export function getAgentConversation(orgSlug: string, projectSlug: string, docId: string): Promise<AgentConversationDto> {
  return request<AgentConversationDto>(`${agentBase(orgSlug, projectSlug, docId)}/conversation`);
}

export function acceptAgentProposal(orgSlug: string, projectSlug: string, docId: string, proposalId: string): Promise<AcceptAgentProposalResult> {
  return request<AcceptAgentProposalResult>(`${agentBase(orgSlug, projectSlug, docId)}/proposals/${encodeURIComponent(proposalId)}/accept`, { method: 'POST' });
}

export function rejectAgentProposal(orgSlug: string, projectSlug: string, docId: string, proposalId: string): Promise<{ status: 'rejected'; proposal: AgentProposalDto }> {
  return request<{ status: 'rejected'; proposal: AgentProposalDto }>(`${agentBase(orgSlug, projectSlug, docId)}/proposals/${encodeURIComponent(proposalId)}/reject`, { method: 'POST' });
}
