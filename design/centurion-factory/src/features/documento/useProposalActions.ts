/** Accepting/rejecting an agent proposal against the current (possibly Markdown-pending) blocks. */
import { useState } from 'react';
import { proposalsForDocument, type AgentProposal, type DocumentBlock, type VersionReason } from '../../data';
import { CURRENT_USER_ID, CURRENT_USER_NAME } from './documentEditorConstants';
import { findMatchingBlock, stripLinePrefix } from './proposalEdits';

export type ProposalOutcome = { readonly toast: string; readonly stale?: boolean };

export interface UseProposalActionsOptions {
  readonly id: string;
  readonly effectiveBlocks: () => readonly DocumentBlock[];
  readonly setBlocks: (next: readonly DocumentBlock[]) => void;
  readonly addVersion: (reason: VersionReason) => void;
}

export interface UseProposalActionsResult {
  readonly proposals: readonly AgentProposal[];
  readonly acceptProposal: (proposalId: string) => ProposalOutcome;
  readonly rejectProposal: (proposalId: string) => void;
}

export function useProposalActions({ id, effectiveBlocks, setBlocks, addVersion }: UseProposalActionsOptions): UseProposalActionsResult {
  const [proposals, setProposals] = useState<readonly AgentProposal[]>(() => [...proposalsForDocument(id)]);

  function acceptProposal(proposalId: string): ProposalOutcome {
    const proposal = proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal || proposal.status !== 'pending') return { toast: 'Propuesta aceptada' };

    // Fold in any pending Markdown-tab edit first, so the staleness check (and the eventual
    // replacement) never operates on text the user has already changed but not yet saved.
    const currentBlocks = effectiveBlocks();
    const edit = proposal.edits[0];
    const target = edit ? findMatchingBlock(currentBlocks, edit.expectedText) : undefined;
    if (!edit || !target) {
      setBlocks(currentBlocks);
      setProposals((current) => current.map((item) => (item.id === proposalId ? { ...item, status: 'stale' } : item)));
      return { toast: 'Esta propuesta quedó vieja', stale: true };
    }

    setBlocks(
      currentBlocks.map((block) =>
        block.id === target.id ? { ...block, text: stripLinePrefix(edit.replacement), author: 'agent', acceptedBy: CURRENT_USER_NAME } : block,
      ),
    );
    setProposals((current) => current.map((item) => (item.id === proposalId ? { ...item, status: 'accepted', respondedBy: CURRENT_USER_ID } : item)));
    addVersion('agent_accept');
    return { toast: 'Propuesta aceptada' };
  }

  function rejectProposal(proposalId: string): void {
    setProposals((current) => current.map((item) => (item.id === proposalId ? { ...item, status: 'rejected', respondedBy: CURRENT_USER_ID } : item)));
  }

  return { proposals, acceptProposal, rejectProposal };
}
