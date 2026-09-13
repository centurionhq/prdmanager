const STOPWORDS = new Set(
  (
    'the and for with that this from are was were have has not but you your our can will into about ' +
    'los las del por para con una uno unos unas que como más pero sus ese esa esto este esta hay muy sin sobre ' +
    'entre cuando donde también porque desde hasta ser son fue era han tiene tienen puede pueden'
  ).split(' '),
);
const MAX_TERMS = 32;

/** Builds a Lucene OR-query from free text; terms are letters/digits only, so no Lucene syntax can be injected. */
export function buildLuceneQuery(text: string): string | null {
  const terms = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]{3,}/gu)) {
    const term = match[0];
    if (!STOPWORDS.has(term)) terms.add(term);
    if (terms.size >= MAX_TERMS) break;
  }
  return terms.size === 0 ? null : [...terms].join(' OR ');
}
