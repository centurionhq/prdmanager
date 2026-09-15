/** `.prdm/` entries that must never be committed: the engine lock, per-transaction journals, the stale marker and draft sessions (FR-001 / SDD-003: working state, not source of truth). */
export const REQUIRED_GITIGNORE_LINES: readonly string[] = ['.prdm/engine.lock', '.prdm/journal-*.json', '.prdm/graph-stale', '.prdm/drafts/', '.prdm/symbol-cache.json'];

/** `prdm link`'s own scaffold addition (SDD-010, WO-188): the governance cache `prdm sync`'s remote mode
 * writes under `.prdm/remote/` is working state fetched from the server, never source of truth. */
export const REMOTE_GITIGNORE_LINES: readonly string[] = ['.prdm/remote/'];

/**
 * Computes the new `.gitignore` content when one or more of `requiredLines` is missing. Returns `null`
 * when every required line is already present (idempotent re-run).
 */
export function planGitignoreLines(existing: string | null, requiredLines: readonly string[]): string | null {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const missing = requiredLines.filter((line) => !lines.includes(line));
  if (missing.length === 0) return null;

  if (!existing || existing.length === 0) return `${missing.join('\n')}\n`;
  const withTrailingNewline = existing.endsWith('\n') ? existing : `${existing}\n`;
  return `${withTrailingNewline}${missing.join('\n')}\n`;
}

/** `prdm init`'s own scaffold addition — unchanged behavior, now a thin wrapper over {@link planGitignoreLines}. */
export function planGitignore(existing: string | null): string | null {
  return planGitignoreLines(existing, REQUIRED_GITIGNORE_LINES);
}
