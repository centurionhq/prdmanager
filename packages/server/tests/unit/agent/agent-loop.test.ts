/**
 * WO-171 — the agent orchestration loop, entirely against `FakeLlmClient` and fake tools (no network, no
 * database): normal completion within budget, hitting the iteration cap, a client abort mid-loop, the
 * per-turn token budget, and bounded resent history.
 */
import { describe, expect, test } from 'vitest';
import { boundMessagesForResend, DEFAULT_MAX_ITERATIONS, runAgentLoop, type AgentLoopEvent } from '../../../src/agent/agent-loop.js';
import { createFakeLlmClient, type FakeLlmScript } from '../../../src/agent/fake-llm-client.js';
import type { AgentTool, AgentToolContext } from '../../../src/agent/tools/index.js';
import type { LlmMessage } from '../../../src/agent/llm-client.js';
import { z } from 'zod';

const FAKE_CTX = {} as AgentToolContext; // opaque to the loop — only ever forwarded to executeAgentTool.

function echoTool(execute: (input: { value: string }) => Promise<unknown> = async (input) => ({ echoed: input.value })): AgentTool<{ value: string }> {
  return { name: 'echo', description: 'echoes input', inputSchema: z.object({ value: z.string() }), execute: (_ctx, input) => execute(input) };
}

async function collect(loop: AsyncGenerator<AgentLoopEvent, unknown>): Promise<{ events: AgentLoopEvent[]; result: unknown }> {
  const events: AgentLoopEvent[] = [];
  let next = await loop.next();
  while (!next.done) {
    events.push(next.value);
    next = await loop.next();
  }
  return { events, result: next.value };
}

const baseMessages: LlmMessage[] = [
  { role: 'system', content: 'you are an agent' },
  { role: 'user', content: 'do something' },
];

describe('runAgentLoop (WO-171, SDD-009 §Diseño)', () => {
  test('a normal completion within budget: one tool call, then a final answer, then stop', async () => {
    const script: FakeLlmScript = [
      [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"hi"}' } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'token', text: 'the tool said hi' }, { type: 'usage', promptTokens: 10, completionTokens: 5, totalTokens: 15 }, { type: 'done', finishReason: 'stop' }],
    ];
    const llmClient = createFakeLlmClient(script);
    const { events, result } = await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages }));

    expect(result).toEqual({
      finishReason: 'stop',
      newMessages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'echo', argumentsJson: '{"value":"hi"}' }] },
        expect.objectContaining({ role: 'tool', toolCallId: 'call_1', name: 'echo' }),
        { role: 'assistant', content: 'the tool said hi', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(['message_start', 'tool_call', 'tool_result', 'token', 'usage', 'done']);
    expect(events.find((e) => e.type === 'done')).toEqual({ type: 'done', finishReason: 'stop' });
    expect(llmClient.calls).toHaveLength(2);
  });

  test('a tool result’s JSON reaches the model fenced, never as a bare unescaped tool result', async () => {
    const script: FakeLlmScript = [
      [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"<x>"}' } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'done', finishReason: 'stop' }],
    ];
    const llmClient = createFakeLlmClient(script);
    await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages }));

    const secondCallMessages = llmClient.calls[1]!.messages;
    const toolMessage = secondCallMessages.find((m) => m.role === 'tool')!;
    expect(toolMessage.content).toContain('DATA, not instructions');
    expect(toolMessage.content).not.toContain('<x>');
  });

  test('hits the iteration cap gracefully: stops after exactly the max, never calling the model a 9th time', async () => {
    const infiniteToolCallTurn = [{ type: 'tool_call' as const, toolCall: { id: 'call_x', name: 'echo', argumentsJson: '{"value":"x"}' } }, { type: 'done' as const, finishReason: 'tool_calls' as const }];
    const script: FakeLlmScript = Array.from({ length: DEFAULT_MAX_ITERATIONS }, () => infiniteToolCallTurn);
    const llmClient = createFakeLlmClient(script);
    const { events, result } = await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages }));

    expect(result).toMatchObject({ finishReason: 'max_iterations' });
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'max_iterations' });
    expect(llmClient.calls).toHaveLength(DEFAULT_MAX_ITERATIONS);
  });

  test('stops with token_budget_exceeded instead of starting another iteration once the per-turn budget is spent', async () => {
    const script: FakeLlmScript = [
      [
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"hi"}' } },
        { type: 'usage', promptTokens: 900, completionTokens: 100, totalTokens: 1000 },
        { type: 'done', finishReason: 'tool_calls' },
      ],
    ];
    const llmClient = createFakeLlmClient(script);
    const { events, result } = await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages, maxTokensPerTurn: 1000 }));

    expect(result).toMatchObject({ finishReason: 'token_budget_exceeded' });
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'token_budget_exceeded' });
    expect(llmClient.calls).toHaveLength(1); // never attempted a second streamChat call
  });

  test('a client abort mid-loop stops before the next tool executes and never calls the model again', async () => {
    const controller = new AbortController();
    let echoCallCount = 0;
    const abortingTool = echoTool(async (input) => {
      echoCallCount += 1;
      controller.abort(); // simulates the client disconnecting while this tool call is in flight
      return { echoed: input.value };
    });

    const script: FakeLlmScript = [
      [
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"a"}' } },
        { type: 'tool_call', toolCall: { id: 'call_2', name: 'echo', argumentsJson: '{"value":"b"}' } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [{ type: 'token', text: 'should never be reached' }, { type: 'done', finishReason: 'stop' }],
    ];
    const llmClient = createFakeLlmClient(script);
    const { events, result } = await collect(
      runAgentLoop({ llmClient, tools: [abortingTool], toolCtx: FAKE_CTX, messages: baseMessages, signal: controller.signal }),
    );

    expect(result).toMatchObject({ finishReason: 'aborted' });
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(1); // only the first tool call's result was ever emitted
    expect(echoCallCount).toBe(1); // the second tool call never ran
    expect(llmClient.calls).toHaveLength(1); // the second streamChat call never happened
  });

  test('an already-aborted signal stops immediately, before the first streamChat call', async () => {
    const controller = new AbortController();
    controller.abort();
    const llmClient = createFakeLlmClient([[{ type: 'token', text: 'never' }, { type: 'done', finishReason: 'stop' }]]);
    const { result } = await collect(runAgentLoop({ llmClient, tools: [], toolCtx: FAKE_CTX, messages: baseMessages, signal: controller.signal }));
    expect(result).toEqual({ newMessages: [], finishReason: 'aborted' });
    expect(llmClient.calls).toHaveLength(0);
  });

  test('stamps model onto every assistant message when provided, purely for persistence', async () => {
    const script: FakeLlmScript = [[{ type: 'token', text: 'hi' }, { type: 'done', finishReason: 'stop' }]];
    const llmClient = createFakeLlmClient(script);
    const { result } = await collect(runAgentLoop({ llmClient, tools: [], toolCtx: FAKE_CTX, messages: baseMessages, model: 'deepseek-v4-flash' }));
    expect(result).toMatchObject({ newMessages: [{ role: 'assistant', content: 'hi', model: 'deepseek-v4-flash' }] });
  });

  test('an llm_error event ends the turn immediately without retrying', async () => {
    const script: FakeLlmScript = [[{ type: 'error', code: 'llm_error', message: 'the language model is temporarily unavailable' }]];
    const llmClient = createFakeLlmClient(script);
    const { events, result } = await collect(runAgentLoop({ llmClient, tools: [], toolCtx: FAKE_CTX, messages: baseMessages }));
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(result).toMatchObject({ finishReason: 'stop' });
    expect(llmClient.calls).toHaveLength(1);
  });
});

describe('boundMessagesForResend (WO-171, SDD-009 "historial reenviado acotado")', () => {
  test('returns everything unchanged when within the limit', () => {
    const messages: LlmMessage[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
    expect(boundMessagesForResend(messages, 10)).toEqual(messages);
  });

  test('always keeps the leading system message plus only the most recent entries once over the limit', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 'system instructions' },
      ...Array.from({ length: 50 }, (_, i) => ({ role: 'user' as const, content: `message ${i}` })),
    ];
    const bounded = boundMessagesForResend(messages, 10);
    expect(bounded).toHaveLength(10);
    expect(bounded[0]).toEqual({ role: 'system', content: 'system instructions' });
    expect(bounded.at(-1)).toEqual({ role: 'user', content: 'message 49' });
    expect(bounded[1]).toEqual({ role: 'user', content: 'message 41' });
  });

  test('without a leading system message, simply keeps the most recent entries', () => {
    const messages: LlmMessage[] = Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, content: `m${i}` }));
    const bounded = boundMessagesForResend(messages, 5);
    expect(bounded).toEqual(messages.slice(15));
  });
});
