/**
 * `FakeLlmClient` (SDD-009 §Diseño: "guionado, inyectado por buildServer; es el único usado en tests y
 * E2E"), WO-167. Deterministic and network-free: a `FakeLlmScript` is an ordered list of turns, one
 * consumed per `streamChat` call — the Nth call to `streamChat` on a given instance always replays the
 * Nth scripted turn, regardless of what messages/tools it was actually called with (a turn function
 * *may* inspect its input if a test needs to assert on it, but nothing here does that automatically).
 *
 * Throws (rather than silently looping the last turn or returning an empty stream) once the script is
 * exhausted: a test whose agent loop calls `streamChat` more times than the test author scripted for is a
 * bug in the test or the loop, not something that should degrade into an infinite silent loop.
 */
import type { LlmClient, LlmEvent, StreamChatInput } from './llm-client.js';

/** A turn is either a fixed list of events, or a function of the actual call input — the latter lets a
 * test assert against what was sent (e.g. "the fenced document appears in the user message") before
 * deciding how to respond. */
export type FakeLlmTurn = readonly LlmEvent[] | ((input: StreamChatInput) => readonly LlmEvent[]);

export type FakeLlmScript = readonly FakeLlmTurn[];

export class FakeLlmScriptExhaustedError extends Error {
  constructor(callIndex: number) {
    super(`FakeLlmClient: streamChat called a ${callIndex + 1}th time but the script only has ${callIndex} turn(s) scripted`);
    this.name = 'FakeLlmScriptExhaustedError';
  }
}

export interface FakeLlmClient extends LlmClient {
  /** Every `streamChat` input this instance has ever received, in call order — lets a test assert on the
   * *sequence* of calls the loop made (e.g. "the second call's messages include the tool result"). */
  readonly calls: StreamChatInput[];
}

async function* replay(events: readonly LlmEvent[], signal: AbortSignal | undefined): AsyncIterable<LlmEvent> {
  for (const event of events) {
    if (signal?.aborted) {
      yield { type: 'done', finishReason: 'aborted' };
      return;
    }
    yield event;
  }
}

export function createFakeLlmClient(script: FakeLlmScript): FakeLlmClient {
  const calls: StreamChatInput[] = [];
  let nextCallIndex = 0;

  return {
    calls,
    streamChat(input) {
      const callIndex = nextCallIndex;
      nextCallIndex += 1;
      calls.push(input);

      const turn = script[callIndex];
      if (turn === undefined) throw new FakeLlmScriptExhaustedError(callIndex);

      const events = typeof turn === 'function' ? turn(input) : turn;
      return replay(events, input.signal);
    },
  };
}
