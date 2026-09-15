/**
 * Project CI tokens section on `/o/:orgSlug/p/:projectSlug/settings` (SDD-006 §Permisos
 * "tokens de CI", `manage_ci_tokens`, project admin only, WO-119) — mounted by `AjustesTokens.tsx`
 * only once `can(subject, 'manage_ci_tokens')` is true, same as the members section's own gate.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { CreatedTokenResponse, TokenScopeDto, TokenSummaryDto } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { createCiToken, listCiTokens, revokeCiToken } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { CI_TOKEN_SCOPES } from '../auth/token-scopes.js';
import { FormError } from '../components/FormError.js';
import { TokenCreateForm } from '../components/TokenCreateForm.js';
import { TokenSecretPanel } from '../components/TokenSecretPanel.js';
import { TokenTable } from '../components/TokenTable.js';
import styles from '../styles/forms.module.css';

export function CiTokensSection({ orgSlug, projectSlug }: { orgSlug: string; projectSlug: string }): ReactElement {
  const [tokens, setTokens] = useState<TokenSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedTokenResponse | null>(null);

  useEffect(() => {
    setTokens(null);
    listCiTokens(orgSlug, projectSlug)
      .then(setTokens)
      .catch((err) => setError(errorMessage(err)));
  }, [orgSlug, projectSlug]);

  async function handleCreate(input: { name: string; scopes: TokenScopeDto[]; expiresAt: string }): Promise<void> {
    const result = await createCiToken(orgSlug, projectSlug, { ...input, projectIds: [] });
    setJustCreated(result);
    setTokens((prev) => [...(prev ?? []), result.token]);
  }

  async function handleRevoke(tokenId: string): Promise<void> {
    try {
      await revokeCiToken(orgSlug, projectSlug, tokenId);
      setTokens((prev) => (prev ?? []).map((t) => (t.id === tokenId ? { ...t, revokedAt: new Date().toISOString() } : t)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <h2 className={styles.title}>Tokens de CI</h2>
      <FormError message={error} />
      {justCreated && <TokenSecretPanel secret={justCreated.secret} onDismiss={() => setJustCreated(null)} />}
      {!tokens ? <LoadingState label="Cargando tokens de CI…" /> : <TokenTable tokens={tokens} onRevoke={(id) => void handleRevoke(id)} />}
      <TokenCreateForm availableScopes={CI_TOKEN_SCOPES} onCreate={handleCreate} />
    </div>
  );
}
