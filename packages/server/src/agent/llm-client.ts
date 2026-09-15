/**
 * `LlmClient` port (SDD-009 §Diseño: "Puerto LlmClient streamChat({messages, tools, maxTokens, signal}) →
 * AsyncIterable<LlmEvent>"), WO-167.
 *
 * Deliberately narrow and OpenAI-compatible-shaped (DeepSeek's own API is OpenAI-compatible per ADR-006)
 * so `./deepseek-client.ts` is a thin adapter, not a translation layer: a tool definition is a JSON-schema
 * function description, a message is `{role, content}` plus the two OpenAI-specific extensions
 * (`toolCalls` on an assistant turn, `toolCallId`/`name` on a tool-result turn) needed to round-trip a
 * multi-turn tool loop (`./agent-loop.ts`, WO-171).
 *
 * `LlmEvent` is the *provider* stream's own vocabulary — `token`/`tool_call`/`usage`/`done`/`error`. The
 * SSE endpoint (WO-172) has a richer event vocabulary of its own (`message_start`, `tool_result`,
 * `proposal`, ...) that the agent loop derives from these plus its own tool-execution results; the two are
 * not the same enum on purpose; conflating "what the model said" with "what the loop then did about it"
 * would make `FakeLlmClient` scripts implicitly encode orchestration behavior that belongs to the loop.
 */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmToolCall {
  /** Provider-assigned id — round-tripped verbatim in the follow-up `role: 'tool'` message so the
   * provider can match a result back to the call that requested it (OpenAI/DeepSeek both require this). */
  id: string;
  name: string;
  /** Raw JSON text, exactly as the provider streamed it — parsing/validating against a tool's zod schema
   * is `./tools/*.ts`'s job (WO-169), not this port's. */
  argumentsJson: string;
}

export interface LlmMessage {
  role: LlmRole;
  /** Empty string is valid for an assistant turn that is pure tool calls. */
  content: string;
  /** Only ever set on an assistant message that requested one or more tool calls. */
  toolCalls?: LlmToolCall[];
  /** Only ever set on a `role: 'tool'` message — which call this is the result of. */
  toolCallId?: string;
  /** Only ever set on a `role: 'tool'` message — the tool's own name, mirrored back per the OpenAI shape. */
  name?: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** A JSON Schema object (what `zod-to-json-schema` or an equivalent hand-written schema produces) — this
   * port never depends on zod itself, only on the wire shape a tool definition needs. */
  parameters: Record<string, unknown>;
}

export interface StreamChatInput {
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal;
}

export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'aborted';

export type LlmEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; toolCall: LlmToolCall }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'done'; finishReason: LlmFinishReason }
  /** `code` is always the fixed `'llm_error'` sentinel (SDD-009 §Seguridad y costo: "los errores del SDK
   * se mapean a {code: 'llm_error'} con mensaje fijo") — `message` is a fixed, non-provider-derived string
   * too, never the raw SDK error (which could embed request/response details). */
  | { type: 'error'; code: 'llm_error'; message: string };

export interface LlmClient {
  streamChat(input: StreamChatInput): AsyncIterable<LlmEvent>;
}
