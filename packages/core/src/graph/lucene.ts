import { PROJECT_ID_PATTERN } from '../project/types.js';

const STOPWORDS = new Set(
  (
    'the and for with that this from are was were have has not but you your our can will into about ' +
    'los las del por para con una uno unos unas que como más pero sus ese esa esto este esta hay muy sin sobre ' +
    'entre cuando donde también porque desde hasta ser son fue era han tiene tienen puede pueden'
  ).split(' '),
);
const MAX_TERMS = 32;

/** Extracts significant lowercase terms (letters/digits, length >= 3, stopwords removed, capped at 32). */
export function extractQueryTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]{3,}/gu)) {
    const term = match[0];
    if (!STOPWORDS.has(term)) terms.add(term);
    if (terms.size >= MAX_TERMS) break;
  }
  return [...terms];
}

/** Builds a Lucene OR-query from free text; terms are letters/digits only, so no Lucene syntax can be injected. */
export function buildLuceneQuery(text: string): string | null {
  const terms = extractQueryTerms(text);
  return terms.length === 0 ? null : terms.join(' OR ');
}

/**
 * Builds a `node_text_v2` query scoped to one project (ADR-002 D5): `project_id` is validated against the
 * `prj_<16hex>` allowlist before it ever reaches the Lucene query string, and `prj_<16hex>` tokenizes as a single
 * token under the standard analyzer, so no project can share a prefix with another. Returns null when the free
 * text has no significant terms (nothing to search for, even within the project).
 */
export function buildScopedLuceneQuery(text: string, projectId: string): string | null {
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error(`invalid project id "${projectId}" (expected prj_ followed by 16 hex chars)`);
  const terms = buildLuceneQuery(text);
  if (!terms) return null;
  return `+project_id:"${projectId}" +(${terms})`;
}
