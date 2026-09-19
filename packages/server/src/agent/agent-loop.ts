/**
 * Agent orchestration loop (SDD-009 §Diseño: "Bucle: máximo 8 iteraciones de tools, tope de tokens por
 * turno, historial reenviado acotado, cancelable"; WO-171): send messages -> model responds (text and/or
 * tool calls) -> execute tool calls -> feed results back -> repeat, until the model stops requesting
 * tools, the iteration cap is hit, the per-turn token budget runs out, or the caller aborts.
 *
 * Two different "history" concepts, on purpose (SDD-009 "historial reenviado acotado"):
 * - `history` (this module's own local variable) is the *complete* record of every message this turn
 *   produced — every caller (WO-172's endpoint) persists all of it via `@prdm/db`'s `agent_messages`.
 * - What's actually *resent* to `LlmClient.streamChat` on each iteration is `boundMessagesForResend(...)`
 *   — the system message plus only the most recent `maxHistoryMessages` entries — so a long-running,
 *   many-tool-call turn never re-transmits (and re-bills tokens for) its own entire prior transcript on
 *   every single iteration.
 *
 * Abort: `signal` is threaded into every `streamChat` call and checked between iterations and before each
 * tool call — a client disconnecting mid-stream (WO-172 ties this to the Fastify request's own abort
 * signal) stops the loop at the next check point rather than leaking a runaway background completion or
 * continuing to execute already-requested tool calls.
 */
import type { AgentToolContext } from './tools/context.js';
import { buildToolDefinitions, executeAgentTool, type AgentTool } from './tools/index.js';
import { buildFencedToolResultMessage } from './fence.js';
import type { LlmClient, LlmMessage, LlmToolCall } from './llm-client.js';

export const DEFAULT_MAX_ITERATIONS = 8;
export const DEFAULT_MAX_TOKENS_PER_TURN = 8_000;
export const DEFAULT_MAX_HISTORY_MESSAGES = 40;

/** WO-470 (SDD-035): `'error'` is how the loop reports that it fell over. It used to *throw*, which threw
 * away every message the turn had already produced along with it — the caller could only persist what the
 * generator returned, and a generator that throws returns nothing. */
export type AgentLoopFinishReason = 'stop' | 'max_iterations' | 'token_budget_exceeded' | 'aborted' | 'error';

export type AgentLoopEvent =
  | { type: 'message_start' }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; toolCall: LlmToolCall }
  | { type: 'tool_result'; toolCall: LlmToolCall; resultJson: string; ok: boolean }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'done'; finishReason: AgentLoopFinishReason }
  | { type: 'error'; code: string; message: string };

/** A message as returned in `RunAgentLoopResult.newMessages` — a superset of `LlmMessage` with
 * persistence-only metadata (WO-172 stores this in `agent_messages`'s `model`/`*_tokens` columns) that
 * the wire protocol to the provider itself has no use for; passing one of these back into `messages`
 * on a later call is still valid (the extra fields are simply ignored by `LlmClient` implementations). */
export interface AgentTranscriptMessage extends LlmMessage {
  model?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface RunAgentLoopInput {
  llmClient: LlmClient;
  tools: readonly AgentTool[];
  toolCtx: AgentToolContext;
  /** Stamped onto every assistant message in `newMessages` (SDD-009 §Persistencia: `agent_messages`
   * records which model produced each turn) — purely descriptive, never sent to the provider itself. */
  model?: string;
  /** Every message so far, including the leading `system` message — this turn's new `user` message must
   * already be the last entry (the caller, WO-172, appends it before calling this). */
  messages: readonly LlmMessage[];
  maxIterations?: number;
  maxTokensPerTurn?: number;
  maxHistoryMessages?: number;
  signal?: AbortSignal;
}

export interface RunAgentLoopResult {
  /** Every message this turn produced (assistant turns and tool results) — `input.messages` plus these,
   * in order, is the complete transcript the caller persists. */
  newMessages: AgentTranscriptMessage[];
  finishReason: AgentLoopFinishReason;
}

/** SDD-009 "historial reenviado acotado": the system message (if present, always first) is always kept —
 * losing the agent's own instructions is never an acceptable way to shrink a turn — plus only the most
 * recent `maxMessages - 1` entries. A turn with a short history is returned unchanged. */
export function boundMessagesForResend(messages: readonly LlmMessage[], maxMessages: number): LlmMessage[] {
  if (messages.length <= maxMessages) return [...messages];
  const hasLeadingSystemMessage = messages[0]?.role === 'system';
  if (!hasLeadingSystemMessage) return messages.slice(messages.length - maxMessages);
  const [system, ...rest] = messages;
  const tailBudget = maxMessages - 1;
  return [system!, ...rest.slice(rest.length - tailBudget)];
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * WO-470 (SDD-035/PRD-016): appends a result for every tool call this turn requested but never answered,
 * so the transcript the caller persists can never contain an `assistant` with `tool_calls` whose results
 * are missing. That sequence is invalid on every OpenAI-compatible provider, and since the transcript is
 * replayed as history on the *next* turn, one interrupted turn would otherwise poison the conversation
 * permanently — a real failure mode, because the abort check between `assistant` and its tool results is
 * exactly where a client disconnect lands.
 *
 * Synthesised results are fenced like any other tool result: they are data the model reads, not something
 * it should mistake for an instruction, and they say plainly that the call never ran.
 */
export function sealUnansweredToolCalls(newMessages: AgentTranscriptMessage[]): AgentTranscriptMessage[] {
  const answered = new Set(newMessages.filter((message) => message.role === 'tool' && message.toolCallId).map((message) => message.toolCallId));
  const unanswered = newMessages.flatMap((message) => (message.role === 'assistant' ? (message.toolCalls ?? []) : [])).filter((call) => !answered.has(call.id));
  if (unanswered.length === 0) return newMessages;
  return [...newMessages, ...unanswered.map((call) => buildFencedToolResultMessage(call, JSON.stringify({ error: 'interrupted', message: 'the turn ended before this tool call ran' })))];
}

export async function* runAgentLoop(input: RunAgentLoopInput): AsyncGenerator<AgentLoopEvent, RunAgentLoopResult> {
  yield { type: 'message_start' };

  const newMessages: AgentTranscriptMessage[] = [];
  let finishReason: AgentLoopFinishReason;
  try {
    finishReason = yield* runIterations(input, newMessages);
  } catch (error: unknown) {
    // Never rethrown: the caller can only persist what this generator *returns*, so throwing here is the
    // same as discarding the turn. It becomes a `done` with `finishReason: 'error'` like any other ending.
    yield { type: 'error', code: 'loop_failed', message: error instanceof Error ? error.message : 'the agent loop failed unexpectedly' };
    finishReason = 'error';
  }

  const sealed = sealUnansweredToolCalls(newMessages);
  yield { type: 'done', finishReason };
  return { newMessages: sealed, finishReason };
}

/** The loop proper. Returns the reason it stopped; `runAgentLoop` owns emitting `done` and sealing, so
 * that every ending -- including the ones that used to be a `throw` -- goes through one place. */
async function* runIterations(input: RunAgentLoopInput, newMessages: AgentTranscriptMessage[]): AsyncGenerator<AgentLoopEvent, AgentLoopFinishReason> {
  const {
    llmClient,
    tools,
    toolCtx,
    messages: initialMessages,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxTokensPerTurn = DEFAULT_MAX_TOKENS_PER_TURN,
    maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES,
    model,
    signal,
  } = input;

  const history: LlmMessage[] = [...initialMessages];
  let tokensUsedThisTurn = 0;
  const toolDefinitions = buildToolDefinitions(tools);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (isAborted(signal)) return 'aborted';

    const remainingTokens = maxTokensPerTurn - tokensUsedThisTurn;
    if (remainingTokens <= 0) return 'token_budget_exceeded';

    let assistantText = '';
    const toolCalls: LlmToolCall[] = [];
    let modelFinishReason: string | undefined;
    let sawError = false;
    let iterationUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    const resendMessages = boundMessagesForResend(history, maxHistoryMessages);
    for await (const event of llmClient.streamChat({ messages: resendMessages, tools: toolDefinitions, maxTokens: remainingTokens, signal })) {
      if (event.type === 'token') {
        assistantText += event.text;
        yield event;
      } else if (event.type === 'tool_call') {
        toolCalls.push(event.toolCall);
        yield event;
      } else if (event.type === 'usage') {
        tokensUsedThisTurn += event.totalTokens;
        iterationUsage = { promptTokens: event.promptTokens, completionTokens: event.completionTokens, totalTokens: event.totalTokens };
        yield event;
      } else if (event.type === 'error') {
        sawError = true;
        yield event;
      } else if (event.type === 'done') {
        modelFinishReason = event.finishReason;
      }
    }

    if (sawError) return 'stop';
    if (modelFinishReason === 'aborted' || isAborted(signal)) return 'aborted';

    const assistantMessage: AgentTranscriptMessage = {
      role: 'assistant',
      content: assistantText,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(model ? { model } : {}),
      ...(iterationUsage ? { usage: iterationUsage } : {}),
    };
    history.push(assistantMessage);
    newMessages.push(assistantMessage);

    if (toolCalls.length === 0 || modelFinishReason !== 'tool_calls') return 'stop';

    for (const toolCall of toolCalls) {
      // An abort landing here leaves `assistantMessage`'s tool_calls unanswered; `sealUnansweredToolCalls`
      // is what keeps that from reaching the provider as an invalid history next turn.
      if (isAborted(signal)) return 'aborted';

      const result = await executeAgentTool(toolCtx, tools, toolCall.name, toolCall.argumentsJson);
      yield { type: 'tool_result', toolCall, resultJson: result.resultJson, ok: result.ok };

      const toolResultMessage = buildFencedToolResultMessage(toolCall, result.resultJson);
      history.push(toolResultMessage);
      newMessages.push(toolResultMessage);
    }
  }

  return 'max_iterations';
}
