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

export type AgentLoopFinishReason = 'stop' | 'max_iterations' | 'token_budget_exceeded' | 'aborted';

export type AgentLoopEvent =
  | { type: 'message_start' }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; toolCall: LlmToolCall }
  | { type: 'tool_result'; toolCall: LlmToolCall; resultJson: string; ok: boolean }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'done'; finishReason: AgentLoopFinishReason }
  | { type: 'error'; code: string; message: string };

export interface RunAgentLoopInput {
  llmClient: LlmClient;
  tools: readonly AgentTool[];
  toolCtx: AgentToolContext;
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
  newMessages: LlmMessage[];
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

export async function* runAgentLoop(input: RunAgentLoopInput): AsyncGenerator<AgentLoopEvent, RunAgentLoopResult> {
  const {
    llmClient,
    tools,
    toolCtx,
    messages: initialMessages,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxTokensPerTurn = DEFAULT_MAX_TOKENS_PER_TURN,
    maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES,
    signal,
  } = input;

  yield { type: 'message_start' };

  const history: LlmMessage[] = [...initialMessages];
  const newMessages: LlmMessage[] = [];
  let tokensUsedThisTurn = 0;
  const toolDefinitions = buildToolDefinitions(tools);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (isAborted(signal)) {
      yield { type: 'done', finishReason: 'aborted' };
      return { newMessages, finishReason: 'aborted' };
    }

    const remainingTokens = maxTokensPerTurn - tokensUsedThisTurn;
    if (remainingTokens <= 0) {
      yield { type: 'done', finishReason: 'token_budget_exceeded' };
      return { newMessages, finishReason: 'token_budget_exceeded' };
    }

    let assistantText = '';
    const toolCalls: LlmToolCall[] = [];
    let modelFinishReason: string | undefined;
    let sawError = false;

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
        yield event;
      } else if (event.type === 'error') {
        sawError = true;
        yield event;
      } else if (event.type === 'done') {
        modelFinishReason = event.finishReason;
      }
    }

    if (sawError) {
      yield { type: 'done', finishReason: 'stop' };
      return { newMessages, finishReason: 'stop' };
    }
    if (modelFinishReason === 'aborted' || isAborted(signal)) {
      yield { type: 'done', finishReason: 'aborted' };
      return { newMessages, finishReason: 'aborted' };
    }

    const assistantMessage: LlmMessage = { role: 'assistant', content: assistantText, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
    history.push(assistantMessage);
    newMessages.push(assistantMessage);

    if (toolCalls.length === 0 || modelFinishReason !== 'tool_calls') {
      yield { type: 'done', finishReason: 'stop' };
      return { newMessages, finishReason: 'stop' };
    }

    for (const toolCall of toolCalls) {
      if (isAborted(signal)) {
        yield { type: 'done', finishReason: 'aborted' };
        return { newMessages, finishReason: 'aborted' };
      }

      const result = await executeAgentTool(toolCtx, tools, toolCall.name, toolCall.argumentsJson);
      yield { type: 'tool_result', toolCall, resultJson: result.resultJson, ok: result.ok };

      const toolResultMessage = buildFencedToolResultMessage(toolCall, result.resultJson);
      history.push(toolResultMessage);
      newMessages.push(toolResultMessage);
    }
  }

  yield { type: 'done', finishReason: 'max_iterations' };
  return { newMessages, finishReason: 'max_iterations' };
}
