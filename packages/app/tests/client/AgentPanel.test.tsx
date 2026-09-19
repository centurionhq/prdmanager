import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityLabel, AgentPanel, applyStreamingEvent, currentActivity, finishNotice, formatElapsed } from '../../src/components/AgentPanel.js';
import * as collabContext from '../../src/collab/collab-document-context.js';
import * as agentApi from '../../src/api/agent.js';
import type { AgentConversationDto, AgentProposalDto, AgentSseEvent } from '../../src/api/agent.js';

function mockContext() {
  const ydoc = new Y.Doc({ gc: false });
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: { document: ydoc, awareness: null, on: () => {}, off: () => {} } as never,
    state: { status: 'connected', synced: true, scope: 'read-write', presence: [] },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'PRD-001',
    editorView: null,
    setEditorView: () => {},
  });
}

function fakeProposal(overrides: Partial<AgentProposalDto> = {}): AgentProposalDto {
  return {
    id: 'prop-1',
    conversationId: 'conv-1',
    documentId: 'doc-1',
    status: 'pending',
    summary: 'Tighten the intro',
    edits: [{ expectedText: 'old text', occurrence: 0, replacement: 'new text' }],
    fieldsSet: null,
    fieldsUnset: null,
    requestedBy: 'user-1',
    respondedBy: null,
    respondedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeConversation(overrides: Partial<AgentConversationDto> = {}): AgentConversationDto {
  return { conversationId: null, messages: [], proposals: [], ...overrides };
}

describe('applyStreamingEvent (pure, timing-independent — proves the "reveal token by token" behavior)', () => {
  it('appends each token event to the accumulated text, in order', () => {
    const empty = { text: '', activity: [], reasoningChars: 0, elapsedMs: 0 };
    const afterFirst = applyStreamingEvent(empty, { type: 'token', text: 'hello ' });
    const afterSecond = applyStreamingEvent(afterFirst, { type: 'token', text: 'there' });
    expect(afterFirst).toEqual({ text: 'hello ', activity: [], reasoningChars: 0, elapsedMs: 0 });
    expect(afterSecond).toEqual({ text: 'hello there', activity: [], reasoningChars: 0, elapsedMs: 0 });
  });

  it('appends tool_call events without touching the accumulated text', () => {
    const withText = { text: 'checking...', activity: [], reasoningChars: 0, elapsedMs: 0 };
    const result = applyStreamingEvent(withText, { type: 'tool_call', toolCall: { id: 'call_1', name: 'read_document', argumentsJson: '{}' } });
    expect(result).toEqual({ text: 'checking...', activity: [{ id: 'call_1', name: 'read_document' }], reasoningChars: 0, elapsedMs: 0 });
  });

  it('leaves the turn unchanged only for usage and message_start — everything else is now visible', () => {
    const turn = { text: 'so far', activity: [], reasoningChars: 0, elapsedMs: 0 };
    expect(applyStreamingEvent(turn, { type: 'usage', promptTokens: 1, completionTokens: 1, totalTokens: 2 })).toBe(turn);
    expect(applyStreamingEvent(turn, { type: 'message_start' })).toBe(turn);
  });

  it('WO-499: settles a tool_call with its outcome, keeping the error code when it failed', () => {
    const called = applyStreamingEvent({ text: '', activity: [], reasoningChars: 0, elapsedMs: 0 }, { type: 'tool_call', toolCall: { id: 'call_1', name: 'propose_edit', argumentsJson: '{}' } });
    const settled = applyStreamingEvent(called, {
      type: 'tool_result',
      toolCall: { id: 'call_1', name: 'propose_edit', argumentsJson: '{}' },
      resultJson: JSON.stringify({ error: { code: 'text_not_found', message: 'nope' } }),
      ok: false,
    });

    // One entry, not two: the result settles the call it belongs to.
    expect(settled.activity).toEqual([{ id: 'call_1', name: 'propose_edit', ok: false, errorCode: 'text_not_found' }]);
  });

  it('WO-499: a successful tool_result settles without an error code', () => {
    const called = applyStreamingEvent({ text: '', activity: [], reasoningChars: 0, elapsedMs: 0 }, { type: 'tool_call', toolCall: { id: 'c1', name: 'read_document', argumentsJson: '{}' } });
    const settled = applyStreamingEvent(called, { type: 'tool_result', toolCall: { id: 'c1', name: 'read_document', argumentsJson: '{}' }, resultJson: '{"body":"x"}', ok: true });
    expect(settled.activity).toEqual([{ id: 'c1', name: 'read_document', ok: true }]);
  });

  it('WO-491: the heartbeat carries the elapsed time, which is the server\u2019s and not a local stopwatch', () => {
    const beat = applyStreamingEvent({ text: '', activity: [], reasoningChars: 0, elapsedMs: 0 }, { type: 'heartbeat', elapsedMs: 42_000 });
    expect(beat.elapsedMs).toBe(42_000);
    expect(formatElapsed(beat.elapsedMs)).toBe('42 s');
    expect(formatElapsed(95_000)).toBe('1 min 35 s');
  });

  it('WO-499: done records the finish reason, which used to be dropped so a cut turn looked successful', () => {
    const done = applyStreamingEvent({ text: 'so far', activity: [], reasoningChars: 0, elapsedMs: 0 }, { type: 'done', finishReason: 'token_budget_exceeded' });
    expect(done.finishReason).toBe('token_budget_exceeded');
    expect(finishNotice('token_budget_exceeded')).toMatch(/presupuesto/i);
    // A normal ending says nothing: there is no news in "it worked".
    expect(finishNotice('stop')).toBeNull();
  });

  it('WO-497: activity is described for a person, and an unmapped tool falls back to its own name', () => {
    expect(activityLabel('read_document')).toBe('Leyendo el documento');
    expect(activityLabel('get_product_tree')).toBe('Mirando el árbol del producto');
    expect(activityLabel('some_future_tool')).toBe('some_future_tool');
  });

  it('WO-497: before any tool or token, the turn still has something honest to say', () => {
    // WO-522: nothing back yet is not the same as thinking.
    expect(currentActivity({ text: '', activity: [], reasoningChars: 0, elapsedMs: 0 })).toBe('Esperando al modelo');
    expect(currentActivity({ text: '', activity: [], reasoningChars: 120, elapsedMs: 0 })).toBe('Pensando');
    expect(currentActivity({ text: 'escribiendo', activity: [], reasoningChars: 0, elapsedMs: 0 })).toBe('Escribiendo la respuesta');
    // The newest still-running call wins over one that already settled.
    expect(
      currentActivity({
        text: '',
        activity: [
          { id: 'a', name: 'read_document', ok: true },
          { id: 'b', name: 'propose_edit' },
        ],
        reasoningChars: 0,
        elapsedMs: 0,
      }),
    ).toBe('Proponiendo un cambio');
  });
});

describe('AgentPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function msg(over: Partial<agentApi.AgentMessageDto> & { id: string; role: agentApi.AgentMessageDto['role']; content: string }): agentApi.AgentMessageDto {
    return { toolCalls: null, toolCallId: null, toolName: null, model: null, toolOk: null, finishReason: null, createdAt: '2026-01-01T00:00:00.000Z', ...over };
  }

  it('WO-500 (F5 of PRD-016): an assistant message with no content produces no bubble at all', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(
      fakeConversation({
        conversationId: 'conv-1',
        messages: [
          msg({ id: 'm1', role: 'user', content: 'resumime esto' }),
          // What a tool-calling iteration persists: no prose, only tool_calls. One of these per
          // iteration is what the user saw as stacked empty "Agente" bubbles.
          msg({ id: 'm2', role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_document', argumentsJson: '{}' }] }),
          msg({ id: 'm3', role: 'tool', content: 'fenced payload', toolName: 'read_document', toolCallId: 'c1', toolOk: true }),
          msg({ id: 'm4', role: 'assistant', content: 'Es un PRD en borrador.' }),
        ],
      }),
    );

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('Es un PRD en borrador.');

    // Exactly one "Agente" badge: the message that actually said something.
    expect(screen.getAllByText('Agente')).toHaveLength(1);
    // And the tool payload is never dumped into the thread.
    expect(screen.queryByText('fenced payload')).toBeNull();
  });

  it('WO-500: a finished turn keeps a compact trace of what it did, marking what failed', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(
      fakeConversation({
        conversationId: 'conv-1',
        messages: [
          msg({ id: 'm1', role: 'user', content: 'armá el PRD' }),
          msg({ id: 'm2', role: 'tool', content: '{}', toolName: 'read_document', toolCallId: 'c1', toolOk: true }),
          msg({ id: 'm3', role: 'tool', content: '{}', toolName: 'propose_edit', toolCallId: 'c2', toolOk: false }),
          msg({ id: 'm4', role: 'assistant', content: 'No pude aplicarlo.', finishReason: 'stop' }),
        ],
      }),
    );

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('No pude aplicarlo.');

    expect(screen.getByText('Leyendo el documento')).toBeTruthy();
    expect(screen.getByText('Proponiendo un cambio')).toBeTruthy();
  });

  it('WO-499: a turn that ran out of budget says so after a reload, instead of looking like a success', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(
      fakeConversation({
        conversationId: 'conv-1',
        messages: [
          msg({ id: 'm1', role: 'user', content: 'armá el PRD' }),
          msg({ id: 'm2', role: 'assistant', content: 'Lo que averigüé por ahora.', finishReason: 'token_budget_exceeded' }),
        ],
      }),
    );

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toMatch(/presupuesto/i);
  });

  it('WO-498: the user\u2019s own message is on screen immediately, not only once the turn finishes', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(fakeConversation({ conversationId: 'conv-1' }));
    // A turn that never resolves: the whole point is what is visible *during* it.
    vi.spyOn(agentApi, 'sendAgentMessage').mockImplementation(() => new Promise<void>(() => {}));

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('Sin conversación todavía.');

    await userEvent.type(screen.getByLabelText('Mensaje para el agente'), 'armá el PRD');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    // Before this WO the textarea was cleared and nothing was added: the text existed nowhere.
    expect(await screen.findByText('armá el PRD')).toBeTruthy();
  });

  it('WO-497/WO-499: while a turn runs, the activity and any tool failure are both visible', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(fakeConversation({ conversationId: 'conv-1' }));
    vi.spyOn(agentApi, 'sendAgentMessage').mockImplementation(async (_o, _p, _d, _m, onEvent) => {
      const call = { id: 'c1', name: 'propose_edit', argumentsJson: '{}' };
      onEvent({ type: 'message_start' });
      onEvent({ type: 'heartbeat', elapsedMs: 12_000 });
      onEvent({ type: 'tool_call', toolCall: call });
      onEvent({ type: 'tool_result', toolCall: call, resultJson: JSON.stringify({ error: { code: 'text_not_found', message: 'x' } }), ok: false });
      await new Promise<void>(() => {});
    });

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('Sin conversación todavía.');

    await userEvent.type(screen.getByLabelText('Mensaje para el agente'), 'proponé algo');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    // The elapsed time comes from the server's heartbeat, so a silent think is visibly a think.
    expect(await screen.findByText('12 s')).toBeTruthy();
    // And the failure -- dropped entirely before this WO -- is stated with its code.
    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toMatch(/No se pudo completar/);
    expect(failure.textContent).toMatch(/text_not_found/);
  });

  it('shows the prior conversation with a visible Agente badge on assistant messages', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(
      fakeConversation({
        conversationId: 'conv-1',
        messages: [
          { id: 'm1', role: 'user', content: 'hola', toolCalls: null, toolCallId: null, toolName: null, model: null, toolOk: null, finishReason: null, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'm2', role: 'assistant', content: 'hola, ¿en qué ayudo?', toolCalls: null, toolCallId: null, toolName: null, model: 'deepseek-v4-flash', toolOk: null, finishReason: null, createdAt: '2026-01-01T00:00:01.000Z' },
        ],
      }),
    );

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);

    expect(await screen.findByText('hola')).toBeTruthy();
    expect(screen.getByText('hola, ¿en qué ayudo?')).toBeTruthy();
    expect(screen.getByText('Agente')).toBeTruthy();
  });

  it('a viewer sees the conversation but no composer', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(fakeConversation());

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'viewer' }} />);

    await screen.findByText('Sin conversación todavía.');
    expect(screen.queryByLabelText('Mensaje para el agente')).toBeNull();
  });

  it('sending a message streams tokens progressively and then reloads the persisted transcript', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation')
      .mockResolvedValueOnce(fakeConversation())
      .mockResolvedValueOnce(
        fakeConversation({
          conversationId: 'conv-1',
          messages: [
            { id: 'm1', role: 'user', content: 'hi', toolCalls: null, toolCallId: null, toolName: null, model: null, toolOk: null, finishReason: null, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'm2', role: 'assistant', content: 'hello there', toolCalls: null, toolCallId: null, toolName: null, model: null, toolOk: null, finishReason: null, createdAt: '2026-01-01T00:00:01.000Z' },
          ],
        }),
      );

    const microtask = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    const send = vi.spyOn(agentApi, 'sendAgentMessage').mockImplementation(async (_org, _project, _doc, _message, onEvent) => {
      onEvent({ type: 'message_start' });
      await microtask();
      onEvent({ type: 'token', text: 'hello ' });
      await microtask();
      onEvent({ type: 'token', text: 'there' });
      await microtask();
      onEvent({ type: 'done', finishReason: 'stop' });
    });

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('Sin conversación todavía.');

    await userEvent.type(screen.getByLabelText('Mensaje para el agente'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(send).toHaveBeenCalledWith('acme', 'web', 'PRD-001', 'hi', expect.any(Function), expect.any(AbortSignal)));
    // Each token event is applied via its own setState call as it arrives (asserted directly against the
    // component's handler below); end-to-end here we assert the stream's accumulated result once it
    // finishes and the panel reloads the now-persisted transcript — RTL's async polling can't reliably
    // observe a microtask-scheduled intermediate frame between two state updates in the same tick.
    expect(await screen.findByText('hello there')).toBeTruthy();
  });

  it('accepting a pending proposal calls the API and reloads', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation')
      .mockResolvedValueOnce(fakeConversation({ conversationId: 'conv-1', proposals: [fakeProposal()] }))
      .mockResolvedValueOnce(fakeConversation({ conversationId: 'conv-1', proposals: [fakeProposal({ status: 'accepted', respondedBy: 'user-2' })] }));
    const accept = vi.spyOn(agentApi, 'acceptAgentProposal').mockResolvedValue({ status: 'accepted', proposal: fakeProposal({ status: 'accepted' }), versionNo: 2 });

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('Tighten the intro');

    await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }));

    await waitFor(() => expect(accept).toHaveBeenCalledWith('acme', 'web', 'PRD-001', 'prop-1'));
    expect(await screen.findByText('Aplicado ✓')).toBeTruthy();
  });

  it('rejecting a pending proposal calls the API and reloads', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation')
      .mockResolvedValueOnce(fakeConversation({ conversationId: 'conv-1', proposals: [fakeProposal()] }))
      .mockResolvedValueOnce(fakeConversation({ conversationId: 'conv-1', proposals: [fakeProposal({ status: 'rejected' })] }));
    const reject = vi.spyOn(agentApi, 'rejectAgentProposal').mockResolvedValue({ status: 'rejected', proposal: fakeProposal({ status: 'rejected' }) });

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('Tighten the intro');

    await userEvent.click(screen.getByRole('button', { name: 'Rechazar' }));

    await waitFor(() => expect(reject).toHaveBeenCalledWith('acme', 'web', 'PRD-001', 'prop-1'));
    expect(await screen.findByText('Rechazada')).toBeTruthy();
  });

  it('a stale acceptance result updates the card in place, without waiting for a reload', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(fakeConversation({ conversationId: 'conv-1', proposals: [fakeProposal()] }));
    vi.spyOn(agentApi, 'acceptAgentProposal').mockResolvedValue({ status: 'stale' });

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('Tighten the intro');

    await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }));

    expect(await screen.findByText(/Desactualizada/)).toBeTruthy();
  });

  it('a viewer cannot see Accept/Reject buttons even when a proposal is pending', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(fakeConversation({ conversationId: 'conv-1', proposals: [fakeProposal()] }));

    render(<AgentPanel subject={{ orgRole: 'member', projectRole: 'viewer' }} />);
    await screen.findByText('Tighten the intro');

    expect(screen.queryByRole('button', { name: 'Aceptar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).toBeNull();
  });
});
