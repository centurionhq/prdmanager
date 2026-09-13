import type { PrdmConfig } from '../config.js';
import { extractQueryTerms } from '../graph/lucene.js';
import type { GraphStore, NodeView, SearchHit } from '../graph/types.js';

export type TriageReason = 'mention' | 'score' | 'none';

export interface LinkDecision {
  autoLinkTo: string[];
  reason: TriageReason;
}

export interface TriageProposal {
  title: string;
  parentId: string | null;
}

export interface TriageResult {
  mentions: string[];
  candidates: SearchHit[];
  autoLinkTo: string[];
  reason: TriageReason;
  proposal: TriageProposal | null;
}

const MENTION_PATTERN = /\b(?:MRD|PRD|FR)-\d{3,}\b/g;
const TITLE_MAX_LENGTH = 80;

/** Returns MRD/PRD/FR ids mentioned in text, deduplicated, in order of first appearance. */
export function extractFeatureMentions(text: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    ordered.push(match[0]);
  }
  return ordered;
}

/** Explicit mentions always win; otherwise auto-link the top candidate only when it clearly beats the runner-up. */
export function decideLinks(mentions: string[], candidates: SearchHit[], triage: PrdmConfig['triage']): LinkDecision {
  if (mentions.length > 0) return { autoLinkTo: [...mentions], reason: 'mention' };

  const [top, runnerUp] = candidates;
  if (!top) return { autoLinkTo: [], reason: 'none' };

  const isClearWinner = !runnerUp || top.score >= runnerUp.score * triage.autoLinkMargin;
  if (top.score >= triage.autoLinkMinScore && isClearWinner) return { autoLinkTo: [top.id], reason: 'score' };
  return { autoLinkTo: [], reason: 'none' };
}

/** Derives a short proposal title from the first sentence (or line) of free text, capped at 80 chars. */
export function proposalTitle(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  const sentenceEnd = firstLine.indexOf('.');
  const sentence = sentenceEnd > 0 ? firstLine.slice(0, sentenceEnd) : firstLine;
  return sentence.length > TITLE_MAX_LENGTH ? sentence.slice(0, TITLE_MAX_LENGTH) : sentence;
}

/** Text actually covered by the fulltext index (see migrations.ts `node_text`), used to gate score-based auto-links. */
function candidateText(node: NodeView): string {
  const tags = Array.isArray(node.tags) ? node.tags.join(' ') : '';
  return [node.title, node.body, tags].filter(Boolean).join(' ').toLowerCase();
}

async function countMatchedTerms(store: GraphStore, candidateId: string, queryTerms: string[]): Promise<number> {
  if (queryTerms.length === 0) return 0;
  const detail = await store.getNode(candidateId);
  if (!detail) return 0;
  const haystack = candidateText(detail.node);
  return queryTerms.filter((term) => haystack.includes(term)).length;
}

/** A score-based decision only holds if the top candidate genuinely shares enough vocabulary with the query; otherwise a single incidental term (e.g. a shared tag) can win on raw score alone. */
async function gateScoreDecision(decision: LinkDecision, top: SearchHit | undefined, text: string, triage: PrdmConfig['triage'], store: GraphStore): Promise<LinkDecision> {
  if (decision.reason !== 'score' || !top) return decision;
  const matched = await countMatchedTerms(store, top.id, extractQueryTerms(text));
  return matched >= triage.minMatchedTerms ? decision : { autoLinkTo: [], reason: 'none' };
}

export async function triageText(store: GraphStore, config: PrdmConfig, text: string): Promise<TriageResult> {
  const rawMentions = extractFeatureMentions(text);
  const mentionNodes = await Promise.all(rawMentions.map((id) => store.getNode(id)));
  const mentions = rawMentions.filter((_, index) => mentionNodes[index]?.node.label === 'Feature');

  const candidates = await store.search(text, { labels: ['Feature'], limit: config.triage.maxCandidates });
  const scored = decideLinks(mentions, candidates, config.triage);
  const decision = await gateScoreDecision(scored, candidates[0], text, config.triage, store);
  const proposal: TriageProposal | null =
    decision.autoLinkTo.length > 0 ? null : { title: proposalTitle(text), parentId: candidates[0]?.id ?? null };

  return { mentions, candidates, autoLinkTo: decision.autoLinkTo, reason: decision.reason, proposal };
}
