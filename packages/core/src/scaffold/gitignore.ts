/** `.prdm/` entries that must never be committed: the engine lock, per-transaction journals, the stale marker and draft sessions (FR-001 / SDD-003: working state, not source of truth). */
export const REQUIRED_GITIGNORE_LINES: readonly string[] = ['.prdm/engine.lock', '.prdm/journal-*.json', '.prdm/graph-stale', '.prdm/drafts/'];

/**
 * Computes the new `.gitignore` content when one or more {@link REQUIRED_GITIGNORE_LINES} are missing.
 * Returns `null` when every required line is already present (idempotent re-run).
 */
export function planGitignore(existing: string | null): string | null {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const missing = REQUIRED_GITIGNORE_LINES.filter((line) => !lines.includes(line));
  if (missing.length === 0) return null;

  if (!existing || existing.length === 0) return `${missing.join('\n')}\n`;
  const withTrailingNewline = existing.endsWith('\n') ? existing : `${existing}\n`;
  return `${withTrailingNewline}${missing.join('\n')}\n`;
}
