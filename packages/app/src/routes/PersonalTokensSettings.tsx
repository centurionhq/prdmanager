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
import { createPersonalToken, listPersonalTokens, revokePersonalToken } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { PERSONAL_TOKEN_SCOPES } from '../auth/token-scopes.js';
import { Button, SectionHeader, Skeleton } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { TokenCreateForm } from '../components/TokenCreateForm.js';
import { TokenSecretPanel } from '../components/TokenSecretPanel.js';
import { TokenTable } from '../components/TokenTable.js';
import { useProjectShellContext } from './ProjectShell.js';
import styles from './TokensScreen.module.css';

export function PersonalTokensSettings(): ReactElement {
  const { orgSlug } = useProjectShellContext();
  const [tokens, setTokens] = useState<TokenSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedTokenResponse | null>(null);
  const [creating, setCreating] = useState(false);
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
    setCreating(false);
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
    <div className={styles.screen}>
      <SectionHeader
        title="Tokens personales"
        subtitle="Credenciales tuyas para conectar tu asistente de código. No las compartas: identifican tus cambios."
        actions={
          creating ? null : (
            <Button type="button" variant="primary" onClick={() => setCreating(true)}>
              Crear token
            </Button>
          )
        }
      />

      {justCreated ? <TokenSecretPanel secret={justCreated.secret} onDismiss={() => setJustCreated(null)} /> : null}
      {creating ? <TokenCreateForm availableScopes={PERSONAL_TOKEN_SCOPES} onCreate={handleCreate} onCancel={() => setCreating(false)} /> : null}
      {!tokens ? <Skeleton rows={3} /> : <TokenTable tokens={tokens} onRevoke={(id) => void handleRevoke(id)} />}
    </div>
  );
}
