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
  type AgentFinishReason,
  type AgentMessageDto,
  type AgentProposalDto,
  type AgentSseEvent,
} from '../api/agent.js';
import { errorMessage } from '../api/error-message.js';
import { useCollabDocumentContext } from '../collab/collab-document-context.js';
import styles from '../styles/agent-panel.module.css';

export interface AgentPanelProps {
  subject: PermissionSubject;
}

export interface ToolActivity {
  id: string;
  name: string;
  /** `undefined` while the call is still running; `true`/`false` once its result arrives. */
  ok?: boolean;
  /** The tool's own error code, when it failed — kept so the detail is available without being loud. */
  errorCode?: string;
}

export interface StreamingTurn {
  text: string;
  activity: ToolActivity[];
  /** Milliseconds the *server* says this turn has been running (WO-491's heartbeat). Never a
   * client-side stopwatch: that would keep counting against a server that had already gone away. */
  elapsedMs: number;
  finishReason?: AgentFinishReason;
}

const EMPTY_TURN: StreamingTurn = { text: '', activity: [], elapsedMs: 0 };

/** WO-497: what the agent is doing, in words a person reading a PRD would use. `read_document` tells
 * nobody anything. An unmapped tool falls back to its own name rather than to silence — a future tool
 * showing up raw beats it showing up not at all. */
const ACTIVITY_LABEL: Record<string, string> = {
  read_document: 'Leyendo el documento',
  search_project: 'Buscando en el proyecto',
  get_node: 'Leyendo un nodo del grafo',
  get_feature_branch: 'Siguiendo la rama de la feature',
  get_template: 'Mirando la plantilla',
  get_project_status: 'Revisando el estado del proyecto',
  get_product_tree: 'Mirando el árbol del producto',
  validate_document: 'Validando el documento',
  propose_edit: 'Proponiendo un cambio',
};

export function activityLabel(toolName: string): string {
  return ACTIVITY_LABEL[toolName] ?? toolName;
}

/** WO-499: why a turn stopped, said plainly. `stop` is the normal ending and needs no announcement. */
const FINISH_NOTICE: Partial<Record<AgentFinishReason, string>> = {
  token_budget_exceeded: 'El agente se quedó sin presupuesto en este turno.',
  max_iterations: 'El agente llegó al límite de pasos de este turno.',
  truncated: 'La respuesta quedó cortada porque alcanzó el largo máximo.',
  error: 'El turno se interrumpió por un error.',
  aborted: 'Lo detuviste.',
};

export function finishNotice(reason: AgentFinishReason | null | undefined): string | null {
  return reason ? (FINISH_NOTICE[reason] ?? null) : null;
}

/** WO-499: the error code a failed tool returned, dug out of the fenced `{"error":{...}}` payload. Only
 * ever used to *label* a failure the server already flagged via `ok: false` — never to decide whether
 * something failed, which is exactly the parsing-as-contract trap `tool_ok` exists to avoid. */
/** WO-497: the phrase for whatever the turn is doing right now — the newest unfinished call, or a plain
 * "thinking" before any tool has been asked for. Before the first token that is all there is to say, and
 * saying it is the difference between "working" and "frozen". */
export function currentActivity(turn: StreamingTurn): string {
  const running = [...turn.activity].reverse().find((a) => a.ok === undefined);
  if (running) return activityLabel(running.name);
  return turn.text === '' ? 'Pensando' : 'Escribiendo la respuesta';
}

/** Seconds under a minute, then minutes — enough precision to notice an abnormal wait without turning
 * the panel into a stopwatch. */
export function formatElapsed(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function toolErrorCode(resultJson: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(resultJson);
    const error = (parsed as { error?: unknown })?.error;
    const code = (error as { code?: unknown })?.code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pure reducer for one SSE turn's in-progress state (exported for a direct, timing-independent unit test
 * of the "reveal token by token" behavior — asserting against actual DOM timing in a jsdom test is
 * inherently timing-sensitive, so the accumulation logic itself is tested in isolation instead).
 *
 * WO-497/WO-499: `tool_result`, `heartbeat` and `done` used to all fall through a `return prev`, which
 * is why a failed tool, a long think and a turn cut short were each invisible. `usage` still does: token
 * counts are an accounting concern, not something the panel shows.
 */
export function applyStreamingEvent(prev: StreamingTurn, event: AgentSseEvent): StreamingTurn {
  if (event.type === 'token') return { ...prev, text: prev.text + event.text };
  if (event.type === 'tool_call') return { ...prev, activity: [...prev.activity, { id: event.toolCall.id, name: event.toolCall.name }] };
  if (event.type === 'heartbeat') return { ...prev, elapsedMs: event.elapsedMs };
  if (event.type === 'done') return { ...prev, finishReason: event.finishReason };
  if (event.type === 'tool_result') {
    const settled: ToolActivity = {
      id: event.toolCall.id,
      name: event.toolCall.name,
      ok: event.ok,
      ...(event.ok ? {} : { errorCode: toolErrorCode(event.resultJson) }),
    };
    const known = prev.activity.some((a) => a.id === event.toolCall.id);
    return { ...prev, activity: known ? prev.activity.map((a) => (a.id === event.toolCall.id ? settled : a)) : [...prev.activity, settled] };
  }
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
  /** WO-498: shown immediately on send and dropped once the persisted transcript includes it. */
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  /** WO-499: what to re-send when a turn ended without answering. */
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const threadEndRef = useRef<HTMLLIElement | null>(null);

  const canUseAgent = can(subject, 'use_agent');
  const canDecideProposals = can(subject, 'accept_agent_proposal');

  async function reload(): Promise<void> {
    try {
      const data = await getAgentConversation(orgSlug, projectSlug, docId);
      setMessages(data.messages);
      setProposals(data.proposals);
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void reload();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, projectSlug, docId]);

  async function handleSend(text: string): Promise<void> {
    if (!text || busy) return;

    setDraft('');
    setError(null);
    setBusy(true);
    setStopped(false);
    setLastSent(text);
    // WO-498: the user's own words go on screen now, not when the turn finishes. Until this, `handleSend`
    // cleared the textarea and touched nothing else, so for the whole turn the message existed nowhere.
    setPendingUserMessage(text);
    setStreaming(EMPTY_TURN);
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
          else setStreaming((prev) => applyStreamingEvent(prev ?? EMPTY_TURN, evt));
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
      // WO-498: the streamed turn stays on screen until the persisted transcript has actually arrived.
      // Clearing it first and reloading without awaiting produced a render with the *previous*
      // transcript — or "Sin conversación todavía." — flashing between the two.
      await reload();
      setStreaming(null);
      setPendingUserMessage(null);
    }
  }

  function handleStop(): void {
    // WO-501: recorded before aborting, so the thread can say the user stopped it rather than leaving
    // the turn to look like it failed on its own.
    setStopped(true);
    abortRef.current?.abort();
  }

  async function handleAccept(proposalId: string): Promise<void> {
    try {
      const result = await acceptAgentProposal(orgSlug, projectSlug, docId, proposalId);
      if (result.status === 'stale') {
        setProposals((prev) => prev.map((p) => (p.id === proposalId ? { ...p, status: 'stale' } : p)));
      } else {
        void reload();
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleReject(proposalId: string): Promise<void> {
    try {
      await rejectAgentProposal(orgSlug, projectSlug, docId, proposalId);
      void reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // WO-500 (F5 of PRD-016): a `role: 'assistant'` message whose content is empty is one iteration's
  // tool-calling turn, not something the agent said. Rendering it produced one empty bordered bubble per
  // iteration -- the "hay mensajes que no salen" the user reported was partly these appearing instead.
  const visibleMessages = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim() !== '');
  const persistedActivity = messages.filter((m) => m.role === 'tool');
  const persistedFinish = finishNotice(messages.at(-1)?.finishReason);
  const streamingNotice = finishNotice(streaming?.finishReason);
  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  const decidedProposals = proposals.filter((p) => p.status !== 'pending');
  // A turn that produced no prose is exactly the "three empty bubbles" case; offer to run it again.
  const canRetry = !busy && lastSent !== null && (streaming?.finishReason ?? messages.at(-1)?.finishReason) !== undefined && (streaming?.finishReason ?? messages.at(-1)?.finishReason) !== 'stop';

  useEffect(() => {
    // WO-501: the thread is a bounded scroller, so without this new content simply grew below the fold.
    // Feature-detected: jsdom has no layout, so it does not implement `scrollIntoView` at all, and an
    // auto-scroll is never worth breaking a render over.
    threadEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [visibleMessages.length, streaming?.text, streaming?.activity.length]);

  return (
    <section className={styles.panel} aria-label="Agente">
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <ul className={styles.thread} aria-busy={busy}>
        {visibleMessages.map((message) => (
          <li key={message.id} className={message.role === 'assistant' ? styles.assistantBubble : styles.userBubble}>
            {message.role === 'assistant' && <span className={styles.agentBadge}>Agente</span>}
            <p className={styles.bubbleContent}>{message.content}</p>
          </li>
        ))}

        {/* WO-500: a persisted turn keeps a compact trace of what it did -- names and outcome, never the
            20 KB payload the `role: 'tool'` message actually holds. */}
        {!streaming && persistedActivity.length > 0 && (
          <li className={styles.activityTrace}>
            {persistedActivity.map((message) => (
              <span key={message.id} className={message.toolOk === false ? styles.activityFailed : styles.activityDone}>
                {activityLabel(message.toolName ?? 'herramienta')}
              </span>
            ))}
          </li>
        )}

        {streaming && (
          <li className={styles.assistantBubble}>
            <span className={styles.agentBadge}>Agente</span>

            {/* WO-497: what it is doing, in words, with the server's own elapsed time. */}
            <div role="status" className={styles.activity}>
              <span className={styles.activityDot} aria-hidden="true" />
              <span className={styles.activityText}>{currentActivity(streaming)}</span>
              {streaming.elapsedMs > 0 && <span className={styles.elapsed}>{formatElapsed(streaming.elapsedMs)}</span>}
            </div>

            {/* WO-499: a tool that failed says so, next to the activity that produced it. Until now the
                `tool_result` event carrying `ok: false` was dropped outright. */}
            {streaming.activity
              .filter((a) => a.ok === false)
              .map((a) => (
                <p key={a.id} role="alert" className={styles.toolFailure}>
                  No se pudo completar «{activityLabel(a.name)}»{a.errorCode ? <span className={styles.toolFailureCode}>{a.errorCode}</span> : null}
                </p>
              ))}

            {streaming.text !== '' && (
              <p className={styles.bubbleContent}>
                {streaming.text}
                <span className={styles.caret} aria-hidden="true" />
              </p>
            )}
          </li>
        )}

        {/* WO-498: the user's own message, on screen from the instant they send it. */}
        {pendingUserMessage !== null && (
          <li className={styles.userBubble}>
            <p className={styles.bubbleContent}>{pendingUserMessage}</p>
          </li>
        )}

        {(streamingNotice ?? persistedFinish) !== null && !busy && (
          <li role="alert" className={styles.turnNotice}>
            <p className={styles.turnNoticeText}>{stopped ? 'Lo detuviste. Lo que alcanzó a escribir quedó arriba.' : (streamingNotice ?? persistedFinish)}</p>
            {canRetry && !stopped && (
              <button type="button" className={styles.smallButton} onClick={() => void handleSend(lastSent ?? '')}>
                Reintentar
              </button>
            )}
          </li>
        )}

        {visibleMessages.length === 0 && !streaming && pendingUserMessage === null && <li className={styles.empty}>Sin conversación todavía.</li>}
        <li ref={threadEndRef} aria-hidden="true" />
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
            void handleSend(draft.trim());
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
              void handleSend(draft.trim());
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
