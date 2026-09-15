/**
 * Agent chat panel (SDD-009 §UI, WO-176): the caller's own conversation for this document (private —
 * `GET .../agent/conversation`, WO-172), a composer that streams the reply token by token as it arrives
 * (`sendAgentMessage`, SSE), and proposal cards with a diff and Accept/Reject (`can(subject,
 * 'accept_agent_proposal')`).
 *
 * UX notes (ui-ux-pro-max review, applied here — not retrofitted onto the Phase 5 panels above it):
 * - Streamed text is revealed as SSE `token` events arrive (a real typewriter, not a spinner-until-done);
 *   a blinking caret marks in-progress text and disappears the instant the turn ends. The blink is a CSS
 *   animation, so `@prdm/ui`'s existing global `prefers-reduced-motion` rule already neutralizes it.
 * - Every assistant message carries a visible "Agente" badge — never rendered as if a person wrote it,
 *   matching this app's own blame gutter ("Agente (aceptado por X)") honesty elsewhere.
 * - Proposal diffs reuse the same added/removed color convention as `VersionsPanel`'s diff (not a new
 *   visual language for the same concept).
 * - Accept is the primary/accent action; Reject is a quiet secondary one, never a destructive/red style —
 *   rejecting a suggestion is low-stakes and reversible (just ask again), unlike a delete.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { can, type PermissionSubject } from '@prdm/contracts';
import {
  acceptAgentProposal,
  getAgentConversation,
  rejectAgentProposal,
  sendAgentMessage,
  type AgentMessageDto,
  type AgentProposalDto,
  type AgentSseEvent,
  type AgentToolCallDto,
} from '../api/agent.js';
import { errorMessage } from '../api/error-message.js';
import { useCollabDocumentContext } from '../collab/collab-document-context.js';
import styles from '../styles/agent-panel.module.css';

export interface AgentPanelProps {
  subject: PermissionSubject;
}

export interface StreamingTurn {
  text: string;
  toolCalls: AgentToolCallDto[];
}

/** Pure reducer for one SSE turn's in-progress state (exported for a direct, timing-independent unit test
 * of the "reveal token by token" behavior — asserting against actual DOM timing in a jsdom test is
 * inherently timing-sensitive, so the accumulation logic itself is tested in isolation instead). `null`
 * events (`usage`, `tool_result`) that don't affect the visible streaming turn return `prev` unchanged. */
export function applyStreamingEvent(prev: StreamingTurn, event: AgentSseEvent): StreamingTurn {
  if (event.type === 'token') return { ...prev, text: prev.text + event.text };
  if (event.type === 'tool_call') return { ...prev, toolCalls: [...prev.toolCalls, event.toolCall] };
  return prev;
}

function ProposalCard({ proposal, canDecide, onAccept, onReject }: { proposal: AgentProposalDto; canDecide: boolean; onAccept: () => void; onReject: () => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const isPending = proposal.status === 'pending';

  async function handle(action: () => void): Promise<void> {
    setBusy(true);
    try {
      action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.proposalCard} aria-label={`Propuesta: ${proposal.summary}`}>
      <p className={styles.proposalHeader}>{proposal.summary}</p>
      {proposal.status !== 'pending' && (
        <p className={styles.proposalStatus}>
          {proposal.status === 'accepted' && <span className={styles.proposalApplied}>Aplicado ✓</span>}
          {proposal.status === 'rejected' && 'Rechazada'}
          {proposal.status === 'stale' && 'Desactualizada: el texto cambió desde que se propuso'}
        </p>
      )}
      <pre className={styles.proposalDiff}>
        {proposal.edits.map((edit, i) => (
          <span key={i}>
            <span className={styles.diffRemoved}>- {edit.expectedText}</span>
            {'\n'}
            <span className={styles.diffAdded}>+ {edit.replacement}</span>
            {i < proposal.edits.length - 1 ? '\n' : ''}
          </span>
        ))}
      </pre>
      {(proposal.fieldsSet || proposal.fieldsUnset) && (
        <p className={styles.fieldsChange}>
          {proposal.fieldsSet && Object.entries(proposal.fieldsSet).map(([key, value]) => `${key}: ${value}`).join(', ')}
          {proposal.fieldsUnset && proposal.fieldsUnset.length > 0 && ` (quita: ${proposal.fieldsUnset.join(', ')})`}
        </p>
      )}
      {canDecide && isPending && (
        <div className={styles.proposalActions}>
          <button type="button" className={styles.acceptButton} disabled={busy} onClick={() => void handle(onAccept)}>
            Aceptar
          </button>
          <button type="button" className={styles.rejectButton} disabled={busy} onClick={() => void handle(onReject)}>
            Rechazar
          </button>
        </div>
      )}
    </div>
  );
}

export function AgentPanel({ subject }: AgentPanelProps): ReactElement {
  const { orgSlug, projectSlug, docId } = useCollabDocumentContext();
  const [messages, setMessages] = useState<AgentMessageDto[]>([]);
  const [proposals, setProposals] = useState<AgentProposalDto[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canUseAgent = can(subject, 'use_agent');
  const canDecideProposals = can(subject, 'accept_agent_proposal');

  function reload(): void {
    getAgentConversation(orgSlug, projectSlug, docId)
      .then((data) => {
        setMessages(data.messages);
        setProposals(data.proposals);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }

  useEffect(() => {
    reload();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, projectSlug, docId]);

  async function handleSend(): Promise<void> {
    const text = draft.trim();
    if (!text || busy) return;

    setDraft('');
    setError(null);
    setBusy(true);
    setStreaming({ text: '', toolCalls: [] });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await sendAgentMessage(
        orgSlug,
        projectSlug,
        docId,
        text,
        (evt) => {
          if (evt.type === 'error') setError(evt.message);
          else setStreaming((prev) => applyStreamingEvent(prev ?? { text: '', toolCalls: [] }, evt));
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    } finally {
      setStreaming(null);
      setBusy(false);
      abortRef.current = null;
      reload(); // the just-persisted turn (and any new proposal) is now readable from the server.
    }
  }

  function handleStop(): void {
    abortRef.current?.abort();
  }

  async function handleAccept(proposalId: string): Promise<void> {
    try {
      const result = await acceptAgentProposal(orgSlug, projectSlug, docId, proposalId);
      if (result.status === 'stale') {
        setProposals((prev) => prev.map((p) => (p.id === proposalId ? { ...p, status: 'stale' } : p)));
      } else {
        reload();
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleReject(proposalId: string): Promise<void> {
    try {
      await rejectAgentProposal(orgSlug, projectSlug, docId, proposalId);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const visibleMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  const decidedProposals = proposals.filter((p) => p.status !== 'pending');

  return (
    <section className={styles.panel} aria-label="Agente">
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <ul className={styles.thread}>
        {visibleMessages.map((message) => (
          <li key={message.id} className={message.role === 'assistant' ? styles.assistantBubble : styles.userBubble}>
            {message.role === 'assistant' && <span className={styles.agentBadge}>Agente</span>}
            <p className={styles.bubbleContent}>{message.content}</p>
          </li>
        ))}
        {streaming && (
          <li className={styles.assistantBubble}>
            <span className={styles.agentBadge}>Agente</span>
            {streaming.toolCalls.map((toolCall) => (
              <p key={toolCall.id} className={styles.toolCall}>
                Usando herramienta: {toolCall.name}
              </p>
            ))}
            <p className={styles.bubbleContent}>
              {streaming.text}
              <span className={styles.caret} aria-hidden="true" />
            </p>
          </li>
        )}
        {visibleMessages.length === 0 && !streaming && <li className={styles.empty}>Sin conversación todavía.</li>}
      </ul>

      {pendingProposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} canDecide={canDecideProposals} onAccept={() => void handleAccept(proposal.id)} onReject={() => void handleReject(proposal.id)} />
      ))}
      {decidedProposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} canDecide={false} onAccept={() => undefined} onReject={() => undefined} />
      ))}

      {canUseAgent && (
        <form
          className={styles.composer}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <label htmlFor="agent-message-draft" className={styles.srOnly}>
            Mensaje para el agente
          </label>
          <textarea
            id="agent-message-draft"
            className={styles.input}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              e.preventDefault();
              void handleSend();
            }}
          />
          {busy ? (
            <button type="button" className={styles.smallButton} onClick={handleStop}>
              Detener
            </button>
          ) : (
            <button type="submit" className={styles.smallButton} disabled={!draft.trim()}>
              Enviar
            </button>
          )}
        </form>
      )}
    </section>
  );
}
