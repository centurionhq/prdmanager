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

/**
 * WO-486 (SDD-039/PRD-020): the turn's ceiling on *total* tokens (prompt + completion), and what the
 * quota reserves.
 *
 * Was 8_000, which measurement showed allowed only 2–3 of the 8 iterations this module declares: each
 * iteration resends the whole bounded history, so the same prompt text is charged again every time
 * (measured on a real turn: iteration 1 = 4_840 prompt + 44 completion, iteration 2 = 5_343 + 1_244,
 * cumulative 11_471 against a 8_000 ceiling). A turn that needed several tools ran out *before* writing
 * its answer, which is what a user saw as three empty bubbles and no reply.
 *
 * Sized so the declared iteration cap is real rather than decorative. It stays a genuine ceiling, and
 * the quota still reconciles down to actual usage the moment the turn ends, so the effect on a day's
 * capacity is what was really spent, not what was reserved.
 */
export const DEFAULT_MAX_TOKENS_PER_TURN = 32_000;

/**
 * WO-486: the provider's own `max_tokens`, i.e. a cap on *generation* only.
 *
 * Deliberately a separate constant and deliberately fixed. It used to be the turn's remaining budget,
 * which meant the agent's room to write shrank as its own conversation grew — and on a late iteration it
 * became small enough to truncate a 12_880-character `propose_edit` argument mid-JSON, which the tool
 * dispatcher then rejected as `invalid_arguments`. Large enough to write a whole document body in one
 * call, because that is exactly the call that was being cut in half.
 */
export const DEFAULT_MAX_COMPLETION_TOKENS_PER_CALL = 8_000;

/**
 * WO-488: once fewer than this many tokens of the turn's budget remain, the loop stops offering tools and
 * spends what is left on one final, tool-free answer. Covers a last prompt (the full resent history,
 * ~5–6k measured) plus room to actually say something.
 */
export const FINAL_ANSWER_HEADROOM_TOKENS = 10_000;

/** WO-488: generation cap for that final, tool-free call. Prose, not a document body. */
export const FINAL_ANSWER_MAX_COMPLETION_TOKENS = 2_000;

export const DEFAULT_MAX_HISTORY_MESSAGES = 40;

/** WO-470 (SDD-035): `'error'` is how the loop reports that it fell over. It used to *throw*, which threw
 * away every message the turn had already produced along with it — the caller could only persist what the
 * generator returned, and a generator that throws returns nothing. */
export type AgentLoopFinishReason = 'stop' | 'max_iterations' | 'token_budget_exceeded' | 'aborted' | 'error' | 'truncated';

export type AgentLoopEvent =
  | { type: 'message_start' }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; toolCall: LlmToolCall }
  | { type: 'tool_result'; toolCall: LlmToolCall; resultJson: string; ok: boolean }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'done'; finishReason: AgentLoopFinishReason }
  /** WO-491 (SDD-040/PRD-020): emitted by the endpoint, not by this loop -- keeping a stream alive is a
   * property of the transport, not of the reasoning. Carries `elapsedMs` because a bare keepalive can
   * mask a real hang: a model that never answers would look "working" forever, and the elapsed time is
   * what lets an abnormal wait be recognised as one. */
  | { type: 'heartbeat'; elapsedMs: number }
  | { type: 'error'; code: string; message: string };

/** A message as returned in `RunAgentLoopResult.newMessages` — a superset of `LlmMessage` with
 * persistence-only metadata (WO-172 stores this in `agent_messages`'s `model`/`*_tokens` columns) that
 * the wire protocol to the provider itself has no use for; passing one of these back into `messages`
 * on a later call is still valid (the extra fields are simply ignored by `LlmClient` implementations). */
export interface AgentTranscriptMessage extends LlmMessage {
  model?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** WO-492 (SDD-040/PRD-020): only on a `role: 'tool'` message — whether that tool call succeeded.
   * Carried here so the caller can persist it in the same INSERT as the message; `executeAgentTool`
   * never rejects, so without this bit a failure is indistinguishable from a success once the wire
   * event is gone. */
  toolOk?: boolean;
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
  /** Ceiling on the turn's *total* (prompt + completion) tokens — see {@link DEFAULT_MAX_TOKENS_PER_TURN}. */
  maxTokensPerTurn?: number;
  /** WO-486: the provider's `max_tokens`, a *generation*-only cap, independent of the turn's budget and
   * of how large the history has grown. See {@link DEFAULT_MAX_COMPLETION_TOKENS_PER_CALL}. */
  maxCompletionTokensPerCall?: number;
  maxHistoryMessages?: number;
  signal?: AbortSignal;
}

export interface RunAgentLoopResult {
  /** Every message this turn produced (assistant turns and tool results) — `input.messages` plus these,
   * in order, is the complete transcript the caller persists. */
  newMessages: AgentTranscriptMessage[];
  finishReason: AgentLoopFinishReason;
}

/**
 * SDD-009 "historial reenviado acotado": the system message (if present, always first) is always kept —
 * losing the agent's own instructions is never an acceptable way to shrink a turn — plus only the most
 * recent entries. A turn with a short history is returned unchanged.
 *
 * WO-504 (SDD-042/FB-023): the cut is aligned to turn boundaries. It used to slice at exactly
 * `maxMessages`, which says nothing about whether the resulting list is *valid*: a `tool` message
 * answers an `assistant` that carries the matching `tool_calls`, so a cut landing between them leaves an
 * orphan the provider rejects outright —
 * `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`.
 *
 * That turned every conversation past `maxMessages` into a permanently broken one: each later turn cut
 * the same way and failed the same way, surfacing only as the client's fixed "temporarily unavailable".
 * Reproduced on a real 42-message conversation before this fix.
 *
 * The cut moves *backwards* to the first message that stands on its own. Backwards, not forwards,
 * because forwards would drop a whole turn that fits perfectly well; backwards includes one or two
 * messages more than the budget and is always valid. The overshoot is a couple of messages, never a turn.
 */
export function boundMessagesForResend(messages: readonly LlmMessage[], maxMessages: number): LlmMessage[] {
  if (messages.length <= maxMessages) return [...messages];
  const hasLeadingSystemMessage = messages[0]?.role === 'system';
  if (!hasLeadingSystemMessage) return messages.slice(alignedStart(messages, messages.length - maxMessages));
  const [system, ...rest] = messages;
  const tailBudget = maxMessages - 1;
  return [system!, ...rest.slice(alignedStart(rest, rest.length - tailBudget))];
}

/** The first index at or before `start` whose message does not depend on an earlier one. A `tool` always
 * does (it answers a specific `tool_call`); a `user` or `assistant` never does. Returns 0 rather than
 * scanning past the beginning. */
function alignedStart(messages: readonly LlmMessage[], start: number): number {
  let index = Math.max(0, start);
  while (index > 0 && messages[index]?.role === 'tool') index -= 1;
  return index;
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
  return [
    ...newMessages,
    ...unanswered.map((call) => ({
      ...buildFencedToolResultMessage(call, JSON.stringify({ error: 'interrupted', message: 'the turn ended before this tool call ran' })),
      // A call that never ran did not succeed: it must read back as a failure, not as a blank.
      toolOk: false,
    })),
  ];
}

/**
 * WO-471 (SDD-035/PRD-016): the protocol invariant every OpenAI-compatible provider enforces on the
 * message list, stated as a check rather than left implicit — a `tool` message must follow the
 * `assistant` that emitted its `tool_call_id`, and every emitted `tool_call_id` must have a result.
 *
 * Worth checking explicitly because it is exactly what the `created_at` ordering bug broke: the
 * transcript was persisted correctly and then *read back* in an order that violated this, so nothing in
 * the write path could have caught it. Returns a human-readable issue per violation, empty when valid.
 */
export function toolCallSequenceIssues(messages: readonly LlmMessage[]): string[] {
  const issues: string[] = [];
  const emitted = new Set<string>();
  const answered = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) emitted.add(call.id);
      continue;
    }
    if (message.role !== 'tool') continue;
    const id = message.toolCallId;
    if (id === undefined) {
      issues.push('a tool message carries no toolCallId');
    } else if (!emitted.has(id)) {
      issues.push(`tool result ${id} appears before the assistant message that requested it`);
    } else if (answered.has(id)) {
      issues.push(`tool call ${id} has more than one result`);
    } else {
      answered.add(id);
    }
  }

  for (const id of emitted) if (!answered.has(id)) issues.push(`tool call ${id} was requested but never answered`);
  return issues;
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
    maxCompletionTokensPerCall = DEFAULT_MAX_COMPLETION_TOKENS_PER_CALL,
    maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES,
    model,
    signal,
  } = input;

  const history: LlmMessage[] = [...initialMessages];
  let tokensUsedThisTurn = 0;
  const toolDefinitions = buildToolDefinitions(tools);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (isAborted(signal)) return 'aborted';

    // WO-488: when what is left can no longer fund another tool-using iteration, spend it on one final
    // tool-free answer instead of stopping mid-work. Cutting out here is what produced a turn of three
    // empty assistant bubbles and no reply.
    if (maxTokensPerTurn - tokensUsedThisTurn < FINAL_ANSWER_HEADROOM_TOKENS) {
      return yield* finalAnswer(input, history, newMessages);
    }

    let assistantText = '';
    const toolCalls: LlmToolCall[] = [];
    let modelFinishReason: string | undefined;
    let sawError = false;
    let iterationUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    const resendMessages = boundMessagesForResend(history, maxHistoryMessages);
    // WO-486: a fixed generation cap, never the turn's remaining budget. See the constant's own comment.
    for await (const event of llmClient.streamChat({ messages: resendMessages, tools: toolDefinitions, maxTokens: maxCompletionTokensPerCall, signal })) {
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

    // WO-489: `'length'` means the provider cut the model off mid-sentence (or mid-tool-argument).
    // Collapsing it into `'stop'` reported a truncated answer as a complete one, and gave the panel no
    // way to say so.
    if (toolCalls.length === 0 && modelFinishReason === 'length') return 'truncated';
    if (toolCalls.length === 0 || modelFinishReason !== 'tool_calls') return 'stop';

    for (const toolCall of toolCalls) {
      // An abort landing here leaves `assistantMessage`'s tool_calls unanswered; `sealUnansweredToolCalls`
      // is what keeps that from reaching the provider as an invalid history next turn.
      if (isAborted(signal)) return 'aborted';

      const result = await executeAgentTool(toolCtx, tools, toolCall.name, toolCall.argumentsJson);
      yield { type: 'tool_result', toolCall, resultJson: result.resultJson, ok: result.ok };

      const toolResultMessage = buildFencedToolResultMessage(toolCall, result.resultJson);
      history.push(toolResultMessage);
      newMessages.push({ ...toolResultMessage, toolOk: result.ok });
    }
  }

  return 'max_iterations';
}

/**
 * WO-488 (SDD-039/PRD-020): the turn's last word. Called when the budget can no longer fund a
 * tool-using iteration — one more model call with **no tools offered**, so the model has nothing to do
 * but answer with what it already gathered.
 *
 * Offering no tools is the whole mechanism: a model that can still call something generally will, and
 * that is exactly how a turn burned its last iteration on a tool call and ended with no prose. Its
 * output is appended to `newMessages` like any other assistant turn, so it persists and seals normally.
 *
 * Deliberately tolerant: if this last call itself errors or is aborted, the turn ends with the reason
 * that applies rather than throwing away everything the turn had already produced.
 */
async function* finalAnswer(
  input: RunAgentLoopInput,
  history: readonly LlmMessage[],
  newMessages: AgentTranscriptMessage[],
): AsyncGenerator<AgentLoopEvent, AgentLoopFinishReason> {
  const { llmClient, maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES, model, signal } = input;

  let assistantText = '';
  let iterationUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  let modelFinishReason: string | undefined;
  let sawError = false;

  const resendMessages = boundMessagesForResend(history, maxHistoryMessages);
  for await (const event of llmClient.streamChat({ messages: resendMessages, tools: [], maxTokens: FINAL_ANSWER_MAX_COMPLETION_TOKENS, signal })) {
    if (event.type === 'token') {
      assistantText += event.text;
      yield event;
    } else if (event.type === 'usage') {
      iterationUsage = { promptTokens: event.promptTokens, completionTokens: event.completionTokens, totalTokens: event.totalTokens };
      yield event;
    } else if (event.type === 'error') {
      sawError = true;
      yield event;
    } else if (event.type === 'done') {
      modelFinishReason = event.finishReason;
    }
    // A `tool_call` here would mean the provider ignored an empty tool list: nothing to execute, and
    // deliberately not forwarded, so the panel never shows an activity that never ran.
  }

  if (assistantText.length > 0) {
    newMessages.push({
      role: 'assistant',
      content: assistantText,
      ...(model ? { model } : {}),
      ...(iterationUsage ? { usage: iterationUsage } : {}),
    });
  }

  if (sawError) return 'error';
  if (modelFinishReason === 'aborted' || isAborted(signal)) return 'aborted';
  if (modelFinishReason === 'length') return 'truncated';
  return 'token_budget_exceeded';
}
