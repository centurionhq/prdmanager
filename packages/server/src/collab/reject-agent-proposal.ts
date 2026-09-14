/**
 * Rejecting an `agent_proposals` row (SDD-009 §Diseño: "Rechazar guarda quién y cuándo") — unlike accept,
 * this never touches the `Y.Doc` at all, so there is no staleness concept here: a proposal whose anchored
 * text has since changed is just as rejectable as one that hasn't.
 */
import { createTenantDb, type AgentProposalRecord } from '@prdm/db';
import type { Pool } from 'pg';

export class ProposalNotFoundError extends Error {}
export class ProposalNotPendingError extends Error {}

export interface RejectAgentProposalInput {
  orgId: string;
  documentId: string;
  proposalId: string;
  rejectingUserId: string;
}

export async function rejectAgentProposal(pool: Pool, input: RejectAgentProposalInput): Promise<AgentProposalRecord> {
  const { orgId, documentId, proposalId, rejectingUserId } = input;
  const tenantDb = createTenantDb(pool).forOrg(orgId);

  const proposal = await tenantDb.agent.proposals.findById(proposalId);
  if (!proposal || proposal.documentId !== documentId) throw new ProposalNotFoundError();
  if (proposal.status !== 'pending') throw new ProposalNotPendingError();

  const rejected = await tenantDb.agent.proposals.markRejected(proposalId, rejectingUserId);
  if (!rejected) throw new ProposalNotPendingError(); // lost a race with a concurrent accept/reject.
  return rejected;
}
