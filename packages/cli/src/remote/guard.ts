/**
 * Rejects a locally-mutating CLI command when the repository is linked to a remote project (SDD-010
 * "Modo remoto", WO-191): `wo generate`, `wo claim`/`complete`, `feedback add`, `fr create`, `ingest`,
 * `close` and `migrate docs` all write to the *local* Neo4j graph and `docs/` tree — neither
 * of which is source of truth once a project is `remote`. Deliberately narrow (only these seven command
 * handlers call it) so read-only commands that happen to share `withContext` (`wo list`, `graph tree`,
 * `metrics`, ...) are never accidentally caught by it.
 * `sync ack` left this list (SDD-087): in remote mode it goes through the audited bearer route.
 */
import { detectProjectFileMode } from '@prdm/core';
import { CliError } from '../errors.js';

export function assertLocalMutationAllowed(root: string, command: string): void {
  const mode = detectProjectFileMode(root);
  if (mode.kind === 'remote') {
    throw new CliError(`"${command}" is not available for a remote-linked project; use the dashboard or the remote MCP instead`);
  }
}
