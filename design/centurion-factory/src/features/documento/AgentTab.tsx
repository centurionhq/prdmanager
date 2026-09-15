/**
 * "Agente" side panel tab (WO-289): the pending proposal's diff with Aceptar/Rechazar, the
 * accepted/rejected confirmation, a stale warning, and the "Pedir un cambio al agente" form.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Check, X } from 'lucide-react';
import { Button, useToast } from '../../components';
import { getPerson, type AgentProposal, type DocumentBlock } from '../../data';
import styles from './AgentTab.module.css';
import { findMatchingBlock } from './proposalEdits';
import type { ProposalOutcome } from './useDocumentEditor';
import { formatRelative } from './format';

export interface AgentTabProps {
  readonly documentId: string;
  readonly blocks: readonly DocumentBlock[];
  readonly proposals: readonly AgentProposal[];
  readonly onAccept: (proposalId: string) => ProposalOutcome;
  readonly onReject: (proposalId: string) => void;
}

function authorName(id: string | undefined): string {
  if (!id) return '';
  return getPerson(id)?.name ?? id;
}

function ProposalCard({
  proposal,
  blocks,
  onAccept,
  onReject,
}: {
  readonly proposal: AgentProposal;
  readonly blocks: readonly DocumentBlock[];
  readonly onAccept: (id: string) => void;
  readonly onReject: (id: string) => void;
}): ReactElement {
  const edit = proposal.edits[0];
  const isStale = proposal.status === 'stale' || (proposal.status === 'pending' && edit !== undefined && !findMatchingBlock(blocks, edit.expectedText));

  if (proposal.status === 'accepted') {
    return (
      <div className={styles.confirmation}>
        <Check aria-hidden="true" size={20} className={styles.acceptedIcon} />
        <div>
          <p className={styles.confirmationTitle}>Aceptada · Agente (aceptado por {authorName(proposal.respondedBy)})</p>
        </div>
      </div>
    );
  }

  if (proposal.status === 'rejected') {
    return (
      <div className={styles.confirmation}>
        <X aria-hidden="true" size={20} />
        <div>
          <p className={styles.confirmationTitle}>Rechazada</p>
          <p className={styles.confirmationBody}>El documento no cambió. Pedí otra propuesta si la necesitás.</p>
        </div>
      </div>
    );
  }

  if (!edit) return <p>Sin cambios propuestos.</p>;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span>
          <span className="id">{proposal.agent}</span> propone un cambio
        </span>
        <span>{formatRelative(proposal.createdAt)}</span>
      </div>
      <p className={styles.summary}>{proposal.summary}</p>
      <div className={styles.diff}>
        <div className={styles.diffLabel}>Sección {edit.section}</div>
        <div className={`${styles.diffLine} ${styles.diffRemoved} id`}>
          <span aria-hidden="true">-</span>
          <span>{edit.expectedText}</span>
        </div>
        <div className={`${styles.diffLine} ${styles.diffAdded} id`}>
          <span aria-hidden="true">+</span>
          <span>{edit.replacement}</span>
        </div>
      </div>
      {isStale ? (
        <p className={styles.staleWarning}>Esta propuesta quedó vieja: el texto cambió desde que el agente la escribió.</p>
      ) : null}
      <div className={styles.actions}>
        <Button type="button" variant="primary" disabled={isStale} onClick={() => onAccept(proposal.id)}>
          Aceptar
        </Button>
        <Button type="button" variant="secondary" onClick={() => onReject(proposal.id)}>
          Rechazar
        </Button>
      </div>
    </div>
  );
}

export function AgentTab({ documentId, blocks, proposals, onAccept, onReject }: AgentTabProps): ReactElement {
  const { show } = useToast();
  const [message, setMessage] = useState('');
  const current = proposals[0];

  function handleAccept(proposalId: string): void {
    const outcome = onAccept(proposalId);
    show(outcome.toast, { tone: outcome.stale ? 'neutral' : 'success' });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!message.trim()) return;
    setMessage('');
    show('Pedido enviado al agente');
  }

  return (
    <div className={styles.tab}>
      {current ? (
        <ProposalCard proposal={current} blocks={blocks} onAccept={handleAccept} onReject={onReject} />
      ) : (
        <p>Sin propuestas del agente para este documento.</p>
      )}

      <form className={styles.requestForm} onSubmit={handleSubmit}>
        <label className={styles.requestLabel} htmlFor="agent-request">
          Pedir un cambio al agente
        </label>
        <textarea
          id="agent-request"
          className={styles.requestInput}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`Describí qué debe cambiar en ${documentId}`}
        />
        <div className={styles.requestActions}>
          <Button type="submit" variant="secondary">
            Enviar pedido
          </Button>
        </div>
      </form>
    </div>
  );
}
