/**
 * What the server can actually know about a developer's setup (SDD-055/PRD-033 R4).
 *
 * Exactly two facts, and the screen never pretends to more: whether a credential that works exists, and
 * whether anything ever authenticated with it. The files that would prove the rest (`.mcp.json`, `.prdm.yaml`)
 * live on that person's machine; a `lastUsedAt` of `null` means "we have not seen a connection", never "your
 * repository is not linked".
 */
import type { TokenSummaryDto } from '@prdm/contracts';
import type { SetupStepId } from './developer-setup.js';

/** The two scopes `prdm mcp-proxy` needs; anything narrower cannot author documents. */
const MCP_SCOPES = ['mcp:read', 'mcp:write'] as const;

export function isUsableMcpCredential(token: TokenSummaryDto, now: Date): boolean {
  if (token.kind !== 'personal' || token.revokedAt !== null) return false;
  if (new Date(token.expiresAt).getTime() <= now.getTime()) return false;
  return MCP_SCOPES.every((scope) => token.scopes.includes(scope));
}

export interface InstallationState {
  readonly hasCredential: boolean;
  /** True when a usable credential has been used at least once — the only evidence that the link and the
   * assistant work end to end. */
  readonly everConnected: boolean;
  /** The step the person has to do next, `null` once there is nothing left to do. */
  readonly currentStep: SetupStepId | null;
}

export function installationState(tokens: readonly TokenSummaryDto[], now: Date): InstallationState {
  const usable = tokens.filter((token) => isUsableMcpCredential(token, now));
  const everConnected = usable.some((token) => token.lastUsedAt !== null);
  const hasCredential = usable.length > 0;
  return { hasCredential, everConnected, currentStep: !hasCredential ? 'credencial' : everConnected ? null : 'vincular' };
}
