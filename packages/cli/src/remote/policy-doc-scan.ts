/**
 * `ParsedDoc[]` (from `scanContents` over a set of governance/policy-docs documents) -> `PolicyDoc[]`
 * (SDD/ADR/WO only) — shared by the remote `commit-msg` hook (WO-197) and `check commits --range`
 * (WO-198), both of which get their documents from the server rather than local git blobs.
 */
import { scanContents, type ParsedDoc, type PolicyDoc, type WorkOrderStatus } from '@prdm/core';

export interface ScannableDocument {
  sourcePath: string;
  content: string;
}

function toPolicyDoc(doc: ParsedDoc): PolicyDoc | null {
  if (doc.node.kind === 'SDD' || doc.node.kind === 'ADR') return { type: doc.node.kind, id: doc.node.id, impactsPaths: doc.impactsPaths };
  if (doc.node.kind === 'WO') return { type: 'WO', id: doc.node.id, status: doc.node.status as WorkOrderStatus, implements: (doc.frontmatter as { implements: string[] }).implements };
  return null;
}

/** Parses every document and keeps only the SDD/ADR/WO ones `checkCommitMessage`'s `evaluateCommit` core
 * cares about — a document that fails to parse is simply skipped (a policy-docs response is a read-only
 * snapshot; there's nothing to "reject" here the way an import/governance write would). */
export function scanPolicyDocs(documents: readonly ScannableDocument[]): PolicyDoc[] {
  const scanned = scanContents(documents.map((d) => ({ path: d.sourcePath, content: d.content })));
  const docs: PolicyDoc[] = [];
  for (const doc of scanned.docs) {
    const policyDoc = toPolicyDoc(doc);
    if (policyDoc) docs.push(policyDoc);
  }
  return docs;
}
