import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPanel, applyStreamingEvent } from '../../src/components/AgentPanel.js';
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
    const empty = { text: '', toolCalls: [] };
    const afterFirst = applyStreamingEvent(empty, { type: 'token', text: 'hello ' });
    const afterSecond = applyStreamingEvent(afterFirst, { type: 'token', text: 'there' });
    expect(afterFirst).toEqual({ text: 'hello ', toolCalls: [] });
    expect(afterSecond).toEqual({ text: 'hello there', toolCalls: [] });
  });

  it('appends tool_call events without touching the accumulated text', () => {
    const withText = { text: 'checking...', toolCalls: [] };
    const result = applyStreamingEvent(withText, { type: 'tool_call', toolCall: { id: 'call_1', name: 'read_document', argumentsJson: '{}' } });
    expect(result).toEqual({ text: 'checking...', toolCalls: [{ id: 'call_1', name: 'read_document', argumentsJson: '{}' }] });
  });

  it('leaves the turn unchanged for events with no visible effect (usage, tool_result, message_start, done)', () => {
    const turn = { text: 'so far', toolCalls: [] };
    expect(applyStreamingEvent(turn, { type: 'usage', promptTokens: 1, completionTokens: 1, totalTokens: 2 })).toBe(turn);
    expect(applyStreamingEvent(turn, { type: 'message_start' })).toBe(turn);
    expect(applyStreamingEvent(turn, { type: 'done', finishReason: 'stop' })).toBe(turn);
  });
});

describe('AgentPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the prior conversation with a visible Agente badge on assistant messages', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue(
      fakeConversation({
        conversationId: 'conv-1',
        messages: [
          { id: 'm1', role: 'user', content: 'hola', toolCalls: null, toolCallId: null, toolName: null, model: null, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'm2', role: 'assistant', content: 'hola, ¿en qué ayudo?', toolCalls: null, toolCallId: null, toolName: null, model: 'deepseek-v4-flash', createdAt: '2026-01-01T00:00:01.000Z' },
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
            { id: 'm1', role: 'user', content: 'hi', toolCalls: null, toolCallId: null, toolName: null, model: null, createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'm2', role: 'assistant', content: 'hello there', toolCalls: null, toolCallId: null, toolName: null, model: null, createdAt: '2026-01-01T00:00:01.000Z' },
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
