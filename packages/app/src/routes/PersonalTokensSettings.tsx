/**
 * `/o/:orgSlug/ajustes/tokens-personales` (SDD-089 §D2, WO-697): personal API tokens (SDD-006 §Permisos
 * "Scopes de tokens"). The screen belongs to the account, not to a project, so it lives at the
 * organization level and is reachable without belonging to any project. The organization always comes
 * from the shell, which resolved it from the URL, and this screen is grouped under "Tu cuenta" with no
 * organization picker of its own (canvas `AjustesTokensPersonales.dc.html`) — it must never fall back to
 * `listOrganizations()[0]`. `useShellOrgSlug()` works under either shell (`OrgShell` and `ProjectShell`):
 * the project context extends the org one. Membership is the shell's business too: an organization the
 * caller does not belong to never reaches this screen (`OrgShell` renders "Organización no encontrada"
 * instead).
 *
 * SDD-062/WO-718 D1: revoking is destructive and irreversible, so the row only opens the `ConfirmDialog` and
 * the mutation runs from its confirm button. The dialog's `pending`/`error` are this screen's own: a failed
 * revoke stays inside the dialog (the token is still usable) instead of replacing the whole screen.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { CreatedTokenResponse, TokenScopeDto, TokenSummaryDto } from '@prdm/contracts';
import { createPersonalToken, listPersonalTokens, revokePersonalToken } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { PERSONAL_TOKEN_SCOPES } from '../auth/token-scopes.js';
import { Button, ConfirmDialog, SectionHeader, Skeleton } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { tokenResourceMeta } from '../lib/token-resource.js';
import { TokenCreateForm } from '../components/TokenCreateForm.js';
import { TokenSecretPanel } from '../components/TokenSecretPanel.js';
import { TokenTable } from '../components/TokenTable.js';
import { useShellOrgSlug } from './OrgShell.js';
import styles from './TokensScreen.module.css';

export function PersonalTokensSettings(): ReactElement {
  const orgSlug = useShellOrgSlug();
  const [tokens, setTokens] = useState<TokenSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedTokenResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TokenSummaryDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
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

  /** The mutation itself is unchanged (`revokePersonalToken`, same optimistic row update); only *when* it runs
   * changed. It is called from the dialog's confirm button, never from the table. */
  async function handleRevoke(target: TokenSummaryDto): Promise<void> {
    setRevokeError(null);
    setRevoking(true);
    try {
      await revokePersonalToken(orgSlug, target.id);
      setTokens((prev) => (prev ?? []).map((t) => (t.id === target.id ? { ...t, revokedAt: new Date().toISOString() } : t)));
      setRevokeTarget(null);
    } catch (err) {
      setRevokeError(errorMessage(err));
    } finally {
      setRevoking(false);
    }
  }

  function askRevoke(token: TokenSummaryDto): void {
    setRevokeError(null);
    setRevokeTarget(token);
  }

  function cancelRevoke(): void {
    setRevokeTarget(null);
    setRevokeError(null);
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
      {!tokens ? <Skeleton rows={3} /> : <TokenTable tokens={tokens} onRevoke={askRevoke} />}

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revocar token"
        description="Deja de funcionar de inmediato. No se puede deshacer."
        resource={revokeTarget ? { name: revokeTarget.name, meta: tokenResourceMeta(revokeTarget) } : undefined}
        confirmLabel="Revocar token"
        busyLabel="Revocando"
        error={revokeError}
        pending={revoking}
        onConfirm={() => {
          if (revokeTarget) void handleRevoke(revokeTarget);
        }}
        onCancel={cancelRevoke}
      />
    </div>
  );
}
