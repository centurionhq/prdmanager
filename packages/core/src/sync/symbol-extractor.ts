/** Extracts the source block of one declared symbol from a file's content (SDD-004). Implementations are pure and synchronous. */
export interface SymbolExtractor {
  /**
   * Returns the source text of `symbol` in `content`, already run through `util/hash.js`'s `normalizeText`
   * (CRLF→LF, trailing whitespace trimmed) so callers can hash the result directly — or `null` when the file
   * doesn't declare `symbol`. `path` is used only to pick a language (e.g. by extension).
   */
  extract(content: string, symbol: string, path: string): string | null;
}
