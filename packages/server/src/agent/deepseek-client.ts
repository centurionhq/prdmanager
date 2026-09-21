/**
 * `DeepSeekClient` (SDD-009 §Diseño; ADR-006): the real `LlmClient` (WO-167), a thin adapter over
 * `openai` 7.15.0's `chat.completions.create({stream: true})` pointed at DeepSeek's OpenAI-compatible API
 * (`baseURL: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'`, `model: env.DEEPSEEK_MODEL ??
 * 'deepseek-v4-flash'`). Never constructed in `main.ts` from an env flag (SDD-009: "No se habilita por
 * variable de entorno en main.ts") — `main.ts` always builds one when `env.deepseek` is present, and no
 * test ever does.
 *
 * Streaming tool-call accumulation: OpenAI-shaped streaming spreads a single tool call's `id`/`name`
 * across the first chunk that mentions its `index` and its JSON `arguments` across every subsequent chunk
 * for that same `index` — this accumulates by `index` into `toolCallsByIndex` and only emits a completed
 * `LlmToolCall` once the stream itself ends (never mid-stream, since `arguments` isn't valid JSON until
 * the last fragment arrives).
 *
 * Error mapping (SDD-009 §Seguridad y costo: "los errores del SDK se mapean a {code: 'llm_error'} con
 * mensaje fijo"): any error thrown by the SDK — network failure, non-2xx response, malformed stream — is
 * caught and replaced with a single fixed `LlmEvent` carrying no provider-derived detail at all, so a
 * request id, a header value, or an upstream error body can never reach a client response or a log line
 * through this path.
 */
import OpenAI from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions.js';
import type { Logger } from 'openai/client.js';
import type { LlmClient, LlmEvent, LlmFinishReason, LlmMessage, LlmToolCall, LlmToolDefinition, StreamChatInput } from './llm-client.js';

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

const FIXED_ERROR_MESSAGE = 'the language model is temporarily unavailable';

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Defaults to a no-op logger — callers (`main.ts`) pass a redacting logger built from the app's own
   * pino instance via {@link createRedactingLogger} below. */
  logger?: Logger;
}

/** Wraps `base` so that any occurrence of `secret` in a logged message or any of its `rest` args is
 * replaced before ever reaching the underlying logger — defense in depth on top of the `openai` SDK's own
 * header/query redaction (SDD-009 §Seguridad y costo: "un test verifica que la clave no aparece en logs
 * ni respuestas"). */
export function createRedactingLogger(base: Logger, secret: string): Logger {
  /** Recurses into plain objects/arrays too — the SDK logs structured request/response details (headers,
   * bodies) as extra args, not just plain message strings, and the secret can end up nested inside those. */
  function redact(value: unknown, seen: Set<unknown> = new Set()): unknown {
    if (typeof value === 'string') return secret.length > 0 ? value.split(secret).join('[redacted]') : value;
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, redact(entryValue, seen)]));
  }
  function wrap(fn: Logger[keyof Logger]): Logger[keyof Logger] {
    return (message: string, ...rest: unknown[]) => fn(redact(message) as string, ...rest.map((entry) => redact(entry)));
  }
  return { error: wrap(base.error), warn: wrap(base.warn), info: wrap(base.info), debug: wrap(base.debug) };
}

function toOpenAiMessages(messages: readonly LlmMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content, tool_call_id: message.toolCallId ?? '' };
    }
    if (message.role === 'assistant') {
      const toolCalls = message.toolCalls;
      return {
        role: 'assistant',
        content: message.content,
        ...(toolCalls && toolCalls.length > 0
          ? { tool_calls: toolCalls.map((call) => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsJson } })) }
          : {}),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toOpenAiTools(tools: readonly LlmToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (tools.length === 0) return undefined;
  return tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

function mapFinishReason(reason: string | null | undefined): LlmFinishReason {
  if (reason === 'tool_calls') return 'tool_calls';
  if (reason === 'length') return 'length';
  return 'stop';
}

interface AccumulatingToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

/**
 * WO-510 (SDD-043/FB-024): the opener of DeepSeek's own special-token syntax. When the model wants a
 * tool it cannot reach through the structured channel, it writes its invocation markup into `content`
 * instead — observed verbatim as `<｜｜DSML｜｜ invoke name="get_node">` after WO-488's tool-free final
 * call. Streamed through, it rendered as text in the panel and was persisted into the transcript.
 *
 * The characters are U+FF5C (fullwidth vertical line), not ASCII pipes: the sequence is effectively
 * impossible in ordinary prose, which is what makes it safe to treat as a sentinel.
 */
const TOOL_MARKUP_SENTINEL = '<\uff5c\uff5c';

/** How many trailing characters of `text` are a proper prefix of the sentinel, i.e. how much must wait
 * for the next delta before it can be judged. `0` for anything that cannot become one — which is every
 * ordinary chunk. */
function partialSentinelLength(text: string): number {
  for (let k = TOOL_MARKUP_SENTINEL.length - 1; k > 0; k -= 1) {
    if (text.endsWith(TOOL_MARKUP_SENTINEL.slice(0, k))) return k;
  }
  return 0;
}

async function* consumeStream(stream: AsyncIterable<ChatCompletionChunk>, signal: AbortSignal | undefined, logger?: Logger): AsyncGenerator<LlmEvent> {
  const toolCallsByIndex = new Map<number, AccumulatingToolCall>();
  let finishReason: LlmFinishReason = 'stop';
  // Content whose tail could still become the sentinel waits for the next delta, so a sentinel split
  // across two of them is caught before any of it reaches the caller.
  let pending = '';
  let suppressing = false;

  for await (const chunk of stream) {
    if (signal?.aborted) {
      yield { type: 'done', finishReason: 'aborted' };
      return;
    }

    const choice = chunk.choices[0];
    const delta = choice?.delta;
    // WO-524 (SDD-046): verified against the live API — the delta carries `content` *and*
    // `reasoning_content`, and only the first was ever read. With a small `max_tokens` the model spends
    // the whole budget reasoning and emits no content at all, which reached the user as an empty turn.
    // The text itself is deliberately not forwarded: activity, not chain of thought.
    const reasoning = (delta as { reasoning_content?: unknown } | undefined)?.reasoning_content;
    if (typeof reasoning === 'string' && reasoning.length > 0) yield { type: 'reasoning', chars: reasoning.length };
    if (delta?.content && !suppressing) {
      pending += delta.content;
      const sentinelAt = pending.indexOf(TOOL_MARKUP_SENTINEL);
      if (sentinelAt === -1) {
        // Hold back only what could still turn into the sentinel: ordinary prose is forwarded with its
        // original chunking, so the typewriter keeps the provider's own cadence.
        const safeUpTo = pending.length - partialSentinelLength(pending);
        if (safeUpTo > 0) {
          yield { type: 'token', text: pending.slice(0, safeUpTo) };
          pending = pending.slice(safeUpTo);
        }
      } else {
        // Everything before the sentinel is real prose and still counts; everything from it on is the
        // model trying to call a tool in text form, and nothing after it is trustworthy output.
        if (sentinelAt > 0) yield { type: 'token', text: pending.slice(0, sentinelAt) };
        pending = '';
        suppressing = true;
        // Logged, never silent: a filter that hides a misbehaving model without saying so is how this
        // kind of thing goes unnoticed for weeks.
        logger?.warn?.('deepseek emitted tool-invocation markup as content; suppressed');
      }
    }

    for (const toolCallDelta of delta?.tool_calls ?? []) {
      const existing = toolCallsByIndex.get(toolCallDelta.index);
      if (existing) {
        existing.argumentsJson += toolCallDelta.function?.arguments ?? '';
      } else {
        toolCallsByIndex.set(toolCallDelta.index, {
          id: toolCallDelta.id ?? '',
          name: toolCallDelta.function?.name ?? '',
          argumentsJson: toolCallDelta.function?.arguments ?? '',
        });
      }
    }

    if (choice?.finish_reason) finishReason = mapFinishReason(choice.finish_reason);

    if (chunk.usage) {
      yield {
        type: 'usage',
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
    }
  }

  // WO-510: whatever is still held back is real content -- the stream ended without a sentinel, so the
  // hold-back that guarded against a split sentinel has to be released or the answer loses its tail.
  if (!suppressing && pending.length > 0) yield { type: 'token', text: pending };

  const toolCalls: LlmToolCall[] = [...toolCallsByIndex.values()].map((call) => ({ id: call.id, name: call.name, argumentsJson: call.argumentsJson }));
  for (const toolCall of toolCalls) yield { type: 'tool_call', toolCall };

  yield { type: 'done', finishReason };
}

export function createDeepSeekClient(options: DeepSeekClientOptions): LlmClient {
  const { apiKey, baseUrl = DEFAULT_DEEPSEEK_BASE_URL, model = DEFAULT_DEEPSEEK_MODEL, logger } = options;
  const client = new OpenAI({ apiKey, baseURL: baseUrl, maxRetries: 1, logLevel: 'warn', logger });

  return {
    async *streamChat(input: StreamChatInput): AsyncGenerator<LlmEvent> {
      try {
        const stream = await client.chat.completions.create(
          {
            model,
            stream: true,
            stream_options: { include_usage: true },
            messages: toOpenAiMessages(input.messages),
            tools: toOpenAiTools(input.tools),
            max_tokens: input.maxTokens,
          },
          { signal: input.signal },
        );
        yield* consumeStream(stream, input.signal, logger);
      } catch (error: unknown) {
        if (input.signal?.aborted) {
          yield { type: 'done', finishReason: 'aborted' };
          return;
        }
        // WO-507 (SDD-042/FB-023): the client keeps the fixed message -- never leak SDK/request detail
        // to a browser. But swallowing it entirely left operators blind: diagnosing FB-023's 400 meant
        // replaying the request from outside the process, because nothing anywhere recorded why the
        // call failed. `logger` is the redacting wrapper built in `main.ts`.
        logger?.error?.('deepseek streamChat failed', error);
        yield { type: 'error', code: 'llm_error', message: FIXED_ERROR_MESSAGE };
      }
    },
  };
}
