import { describe, expect, test } from 'vitest';
import { createFakeLlmClient, FakeLlmScriptExhaustedError } from '../../../src/agent/fake-llm-client.js';
import type { LlmEvent, StreamChatInput } from '../../../src/agent/llm-client.js';

async function collect(events: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const baseInput: StreamChatInput = { messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 100 };

describe('FakeLlmClient (WO-167)', () => {
  test('replays the Nth scripted turn on the Nth streamChat call', async () => {
    const client = createFakeLlmClient([
      [{ type: 'token', text: 'first' }, { type: 'done', finishReason: 'stop' }],
      [{ type: 'token', text: 'second' }, { type: 'done', finishReason: 'stop' }],
    ]);

    const first = await collect(client.streamChat(baseInput));
    const second = await collect(client.streamChat(baseInput));

    expect(first).toEqual([{ type: 'token', text: 'first' }, { type: 'done', finishReason: 'stop' }]);
    expect(second).toEqual([{ type: 'token', text: 'second' }, { type: 'done', finishReason: 'stop' }]);
  });

  test('records every call input in order for the test to assert against', async () => {
    const client = createFakeLlmClient([[{ type: 'done', finishReason: 'stop' }]]);
    await collect(client.streamChat(baseInput));
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toBe(baseInput);
  });

  test('a turn function can inspect the actual call input before deciding what to emit', async () => {
    const client = createFakeLlmClient([
      (input) => [{ type: 'token', text: input.messages[0]!.content.toUpperCase() }, { type: 'done', finishReason: 'stop' }],
    ]);
    const events = await collect(client.streamChat({ ...baseInput, messages: [{ role: 'user', content: 'shout' }] }));
    expect(events[0]).toEqual({ type: 'token', text: 'SHOUT' });
  });

  test('throws once the script is exhausted rather than looping or returning nothing', async () => {
    const client = createFakeLlmClient([[{ type: 'done', finishReason: 'stop' }]]);
    await collect(client.streamChat(baseInput));
    expect(() => client.streamChat(baseInput)).toThrow(FakeLlmScriptExhaustedError);
  });

  test('an aborted signal short-circuits the replay with a synthetic aborted done event', async () => {
    const client = createFakeLlmClient([[{ type: 'token', text: 'never seen' }, { type: 'done', finishReason: 'stop' }]]);
    const controller = new AbortController();
    controller.abort();
    const events = await collect(client.streamChat({ ...baseInput, signal: controller.signal }));
    expect(events).toEqual([{ type: 'done', finishReason: 'aborted' }]);
  });
});
