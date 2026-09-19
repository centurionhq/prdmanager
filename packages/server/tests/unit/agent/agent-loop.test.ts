/**
 * WO-171 — the agent orchestration loop, entirely against `FakeLlmClient` and fake tools (no network, no
 * database): normal completion within budget, hitting the iteration cap, a client abort mid-loop, the
 * per-turn token budget, and bounded resent history.
 */
import { describe, expect, test } from 'vitest';
import {
  boundMessagesForResend,
  DEFAULT_MAX_COMPLETION_TOKENS_PER_CALL,
  DEFAULT_MAX_ITERATIONS,
  FINAL_ANSWER_HEADROOM_TOKENS,
  runAgentLoop,
  toolCallSequenceIssues,
  type AgentLoopEvent,
} from '../../../src/agent/agent-loop.js';
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

describe('WO-470 (SDD-035/PRD-016): a turn that ends badly still returns what it produced', () => {
  test('the loop reports a thrown failure as finishReason "error" instead of throwing the transcript away', async () => {
    const script: FakeLlmScript = [
      [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"hi"}' } }, { type: 'done', finishReason: 'tool_calls' }],
    ];
    const boom = echoTool(() => Promise.reject(new Error('tool blew up')));
    const llmClient = createFakeLlmClient(script);

    // The script has one turn, so the second iteration's streamChat throws FakeLlmScriptExhaustedError
    // from inside the loop -- previously that escaped and the caller persisted nothing at all.
    const { events, result } = await collect(runAgentLoop({ llmClient, tools: [boom], toolCtx: FAKE_CTX, messages: baseMessages }));

    expect(result).toMatchObject({ finishReason: 'error' });
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
    const { newMessages } = result as { newMessages: { role: string; content: string }[] };
    expect(newMessages.length).toBeGreaterThan(0);
    expect(newMessages[0]?.role).toBe('assistant');
  });

  test('an abort partway through an assistant turn\u2019s tool calls still leaves every tool_call answered', async () => {
    const controller = new AbortController();
    // One assistant turn requesting two tools: aborting once the first result is in lands the loop on the
    // abort check *inside* the tool loop, with call_2 requested and unanswered. That is precisely where a
    // client disconnect falls, and the sequence a provider rejects on the next turn.
    const script: FakeLlmScript = [
      [
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"one"}' } },
        { type: 'tool_call', toolCall: { id: 'call_2', name: 'echo', argumentsJson: '{"value":"two"}' } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
    ];
    const llmClient = createFakeLlmClient(script);

    const loop = runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages, signal: controller.signal });
    const events: AgentLoopEvent[] = [];
    let next = await loop.next();
    while (!next.done) {
      events.push(next.value);
      if (next.value.type === 'tool_result') controller.abort();
      next = await loop.next();
    }
    const result = next.value as { finishReason: string; newMessages: { role: string; toolCalls?: { id: string }[]; toolCallId?: string; content: string }[] };

    expect(result.finishReason).toBe('aborted');

    // The invariant that matters: this transcript is replayed to the provider next turn, and an
    // assistant with an unanswered tool_call is rejected there.
    const requested = result.newMessages.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []) : [])).map((c) => c.id);
    const answered = result.newMessages.filter((m) => m.role === 'tool').map((m) => m.toolCallId);
    expect(requested).toEqual(['call_1', 'call_2']);
    expect(answered).toEqual(['call_1', 'call_2']);
    expect(result.newMessages.at(-1)?.content).toContain('interrupted');
  });

  test('a turn that answered every tool call is left exactly as it was', async () => {
    const script: FakeLlmScript = [
      [{ type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"hi"}' } }, { type: 'done', finishReason: 'tool_calls' }],
      [{ type: 'token', text: 'done' }, { type: 'done', finishReason: 'stop' }],
    ];
    const llmClient = createFakeLlmClient(script);
    const { result } = await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages }));
    const { newMessages } = result as { newMessages: { role: string; content: string }[] };

    expect(newMessages.filter((m) => m.role === 'tool')).toHaveLength(1);
    expect(newMessages.some((m) => m.content.includes('interrupted'))).toBe(false);
  });
});

describe('the turn budget (WO-486..WO-489, SDD-039/PRD-020)', () => {
  test('WO-486: the generation cap is fixed and does not shrink as the history grows', async () => {
    const script: FakeLlmScript = [
      [
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"one"}' } },
        { type: 'usage', promptTokens: 4800, completionTokens: 50, totalTokens: 4850 },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'token', text: 'done' },
        { type: 'usage', promptTokens: 5300, completionTokens: 1200, totalTokens: 6500 },
        { type: 'done', finishReason: 'stop' },
      ],
    ];
    const llmClient = createFakeLlmClient(script);
    await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages }));

    // The second call is the one that used to be starved: under the old code `max_tokens` was
    // `8000 - 4850 = 3150`, which is what truncated a long tool argument mid-JSON.
    expect(llmClient.calls).toHaveLength(2);
    expect(llmClient.calls.map((c) => c.maxTokens)).toEqual([DEFAULT_MAX_COMPLETION_TOKENS_PER_CALL, DEFAULT_MAX_COMPLETION_TOKENS_PER_CALL]);
  });

  test('WO-488: a turn that runs out of budget mid-work still ends with prose, from a final call offered no tools', async () => {
    const script: FakeLlmScript = [
      // One tool-using iteration that eats almost the whole turn budget.
      [
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"one"}' } },
        { type: 'usage', promptTokens: 20_000, completionTokens: 100, totalTokens: 20_100 },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      // The final, tool-free call.
      [{ type: 'token', text: 'Esto es lo que averigüé.' }, { type: 'done', finishReason: 'stop' }],
    ];
    const llmClient = createFakeLlmClient(script);
    const { result } = await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages, maxTokensPerTurn: 24_000 }));
    const { newMessages, finishReason } = result as { newMessages: { role: string; content: string }[]; finishReason: string };

    expect(finishReason).toBe('token_budget_exceeded');
    // The point of the whole WO: the turn does not end on three empty bubbles.
    expect(newMessages.at(-1)).toMatchObject({ role: 'assistant', content: 'Esto es lo que averigüé.' });

    // And that last call really was offered nothing to call.
    expect(llmClient.calls).toHaveLength(2);
    expect(llmClient.calls[1]?.tools).toEqual([]);
  });

  test('WO-488: the final answer is skipped when the turn ends normally with budget to spare', async () => {
    const script: FakeLlmScript = [[{ type: 'token', text: 'listo' }, { type: 'done', finishReason: 'stop' }]];
    const llmClient = createFakeLlmClient(script);
    const { result } = await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages }));

    expect((result as { finishReason: string }).finishReason).toBe('stop');
    expect(llmClient.calls).toHaveLength(1);
  });

  test('WO-488: a turn whose budget is exhausted from the start goes straight to the final answer', async () => {
    const script: FakeLlmScript = [[{ type: 'token', text: 'no me alcanzó el presupuesto' }, { type: 'done', finishReason: 'stop' }]];
    const llmClient = createFakeLlmClient(script);
    const { result } = await collect(
      runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages, maxTokensPerTurn: FINAL_ANSWER_HEADROOM_TOKENS - 1 }),
    );

    expect(llmClient.calls).toHaveLength(1);
    expect(llmClient.calls[0]?.tools).toEqual([]);
    expect((result as { finishReason: string }).finishReason).toBe('token_budget_exceeded');
  });

  test('WO-489: a response the provider cut off is reported as truncated, not as a clean stop', async () => {
    const script: FakeLlmScript = [[{ type: 'token', text: 'una respuesta a medio escr' }, { type: 'done', finishReason: 'length' }]];
    const llmClient = createFakeLlmClient(script);
    const { events, result } = await collect(runAgentLoop({ llmClient, tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages }));

    expect((result as { finishReason: string }).finishReason).toBe('truncated');
    expect(events.filter((e) => e.type === 'done')).toEqual([{ type: 'done', finishReason: 'truncated' }]);
  });
});

describe('toolCallSequenceIssues (WO-471, SDD-035/PRD-016)', () => {
  const assistantCalling = (id: string): LlmMessage => ({ role: 'assistant', content: '', toolCalls: [{ id, name: 'echo', argumentsJson: '{}' }] });
  const toolResult = (id: string): LlmMessage => ({ role: 'tool', content: '{}', toolCallId: id, name: 'echo' });

  test('a well-formed turn has no issues', () => {
    expect(
      toolCallSequenceIssues([
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        assistantCalling('call_1'),
        toolResult('call_1'),
        { role: 'assistant', content: 'the answer' },
      ]),
    ).toEqual([]);
  });

  test('catches the exact shape the created_at ordering bug produced: a tool result read back before its assistant', () => {
    const issues = toolCallSequenceIssues([{ role: 'user', content: 'u' }, toolResult('call_1'), assistantCalling('call_1')]);
    expect(issues).toEqual(['tool result call_1 appears before the assistant message that requested it', 'tool call call_1 was requested but never answered']);
  });

  test('catches a tool call left unanswered, which is what an interrupted turn used to persist', () => {
    expect(toolCallSequenceIssues([assistantCalling('call_1')])).toEqual(['tool call call_1 was requested but never answered']);
  });

  test('catches a duplicated result and a result with no toolCallId', () => {
    expect(toolCallSequenceIssues([assistantCalling('call_1'), toolResult('call_1'), toolResult('call_1')])).toEqual(['tool call call_1 has more than one result']);
    expect(toolCallSequenceIssues([{ role: 'tool', content: '{}' }])).toEqual(['a tool message carries no toolCallId']);
  });

  test('what runAgentLoop returns always satisfies the invariant, including when it is cut short', async () => {
    const script: FakeLlmScript = [
      [
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'echo', argumentsJson: '{"value":"one"}' } },
        { type: 'tool_call', toolCall: { id: 'call_2', name: 'echo', argumentsJson: '{"value":"two"}' } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
    ];
    const controller = new AbortController();
    const loop = runAgentLoop({ llmClient: createFakeLlmClient(script), tools: [echoTool()], toolCtx: FAKE_CTX, messages: baseMessages, signal: controller.signal });
    let next = await loop.next();
    while (!next.done) {
      if (next.value.type === 'tool_result') controller.abort();
      next = await loop.next();
    }
    const { newMessages } = next.value as { newMessages: LlmMessage[] };

    expect(toolCallSequenceIssues([...baseMessages, ...newMessages])).toEqual([]);
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

  test('WO-504 (SDD-042/FB-023): the cut never lands on a tool message, so a long conversation stays valid', () => {
    // The exact shape that broke a real 42-message conversation permanently: every later turn cut the
    // same way, and the provider rejected every one of them with
    // "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'".
    const turn = (n: number): LlmMessage[] => [
      { role: 'user', content: `pregunta ${n}` },
      { role: 'assistant', content: '', toolCalls: [{ id: `c${n}`, name: 'read_document', argumentsJson: '{}' }] },
      { role: 'tool', content: '{}', toolCallId: `c${n}`, name: 'read_document' },
      { role: 'assistant', content: `respuesta ${n}` },
    ];
    const messages: LlmMessage[] = [{ role: 'system', content: 'system instructions' }, ...Array.from({ length: 15 }, (_, i) => turn(i)).flat()];

    // Sweep every budget: whatever the cut would have landed on, the result must be sendable.
    for (let max = 2; max <= messages.length; max += 1) {
      const bounded = boundMessagesForResend(messages, max);
      expect(bounded[0]).toEqual({ role: 'system', content: 'system instructions' });
      expect(bounded[1]?.role).not.toBe('tool');
      expect(toolCallSequenceIssues(bounded)).toEqual([]);
    }
  });

  test('WO-504: aligning moves the cut backwards, so it never drops a turn that fits', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'echo', argumentsJson: '{}' }] },
      { role: 'tool', content: '{}', toolCallId: 'c1', name: 'echo' },
      { role: 'assistant', content: 'a1' },
    ];
    // A budget of 3 would have sliced at the `tool`; aligning backwards reaches the assistant that owns it.
    const bounded = boundMessagesForResend(messages, 3);
    expect(bounded.map((m) => m.role)).toEqual(['system', 'assistant', 'tool', 'assistant']);
    expect(bounded.length).toBeGreaterThan(3);
    expect(toolCallSequenceIssues(bounded)).toEqual([]);
  });

  test('WO-504: with no system message the alignment still holds', () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: 'u' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'echo', argumentsJson: '{}' }] },
      { role: 'tool', content: '{}', toolCallId: 'c1', name: 'echo' },
    ];
    const bounded = boundMessagesForResend(messages, 1);
    expect(bounded[0]?.role).not.toBe('tool');
    expect(toolCallSequenceIssues(bounded)).toEqual([]);
  });

  test('without a leading system message, simply keeps the most recent entries', () => {
    const messages: LlmMessage[] = Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, content: `m${i}` }));
    const bounded = boundMessagesForResend(messages, 5);
    expect(bounded).toEqual(messages.slice(15));
  });
});
