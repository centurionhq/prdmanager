/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/tokens-personales` (SDD-013 §"Shell y router", WO-607/FB-083):
 * personal API tokens (SDD-006 §Permisos "Scopes de tokens"). The organization always comes from the
 * project shell, which resolved it from the URL, and this screen is grouped under "Tu cuenta" with no
 * organization picker of its own (canvas `AjustesTokensPersonales.dc.html`) — it must never fall back to
 * `listOrganizations()[0]`. Membership is the shell's business too: an organization the caller does not
 * belong to never reaches this screen (`ProjectShell` renders "Organización no encontrada" instead).
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { CreatedTokenResponse, TokenScopeDto, TokenSummaryDto } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { createPersonalToken, listPersonalTokens, revokePersonalToken } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { PERSONAL_TOKEN_SCOPES } from '../auth/token-scopes.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { TokenCreateForm } from '../components/TokenCreateForm.js';
import { TokenSecretPanel } from '../components/TokenSecretPanel.js';
import { TokenTable } from '../components/TokenTable.js';
import { useProjectShellContext } from './ProjectShell.js';
import dashboardStyles from '../styles/dashboard.module.css';
import styles from '../styles/forms.module.css';

export function PersonalTokensSettings(): ReactElement {
  const { orgSlug } = useProjectShellContext();
  const [tokens, setTokens] = useState<TokenSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedTokenResponse | null>(null);
  useDocumentTitle('Tokens personales');

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    setError(null);
    listPersonalTokens(orgSlug)
      .then((next) => {
        if (!cancelled) setTokens(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  async function handleCreate(input: { name: string; scopes: TokenScopeDto[]; expiresAt: string }): Promise<void> {
    const result = await createPersonalToken(orgSlug, input);
    setJustCreated(result);
    setTokens((prev) => [...(prev ?? []), result.token]);
  }

  async function handleRevoke(tokenId: string): Promise<void> {
    try {
      await revokePersonalToken(orgSlug, tokenId);
      setTokens((prev) => (prev ?? []).map((t) => (t.id === tokenId ? { ...t, revokedAt: new Date().toISOString() } : t)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (error) return <FormError message={error} />;

  return (
    <div className={dashboardStyles.content}>
      <h1 className={styles.title}>Tokens personales</h1>

      {justCreated && <TokenSecretPanel secret={justCreated.secret} onDismiss={() => setJustCreated(null)} />}

      {!tokens ? <LoadingState label="Cargando tokens…" /> : <TokenTable tokens={tokens} onRevoke={(id) => void handleRevoke(id)} />}

      <TokenCreateForm availableScopes={PERSONAL_TOKEN_SCOPES} onCreate={handleCreate} />
    </div>
  );
}
