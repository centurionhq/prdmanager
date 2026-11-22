/**
 * Project CI tokens section on `/o/:orgSlug/p/:projectSlug/settings` (SDD-006 §Permisos
 * "tokens de CI", `manage_ci_tokens`, project admin only, WO-119) — mounted by `AjustesTokens.tsx`
 * only once `can(subject, 'manage_ci_tokens')` is true, same as the members section's own gate.
 *
 * WO-364: deliberately has no "branch" field when creating a token (unlike the canvas mock's own
 * `AjustesTokens.dc.html`) — a real CI token isn't tied to a chosen branch at all; the official drift
 * baseline instead depends on the project's own default branch plus OIDC verifying which CI run produced
 * a report, so this section says so instead of offering a field with no real effect.
 *
 * SDD-062/WO-718 D1: revoking the pipeline credential only happens from the `ConfirmDialog`, whose copy says
 * what breaks (the pipeline needs a new token and an updated secret). A failed revoke stays in the dialog.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { CreatedTokenResponse, TokenScopeDto, TokenSummaryDto } from '@prdm/contracts';
import { createCiToken, listCiTokens, revokeCiToken } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { CI_TOKEN_SCOPES } from '../auth/token-scopes.js';
import { Button, ConfirmDialog, SectionHeader, Skeleton } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { tokenResourceMeta } from '../lib/token-resource.js';
import { TokenCreateForm } from '../components/TokenCreateForm.js';
import { TokenSecretPanel } from '../components/TokenSecretPanel.js';
import { TokenTable } from '../components/TokenTable.js';
import styles from './TokensScreen.module.css';

export function CiTokensSection({ orgSlug, projectSlug }: { orgSlug: string; projectSlug: string }): ReactElement {
  const [tokens, setTokens] = useState<TokenSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedTokenResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TokenSummaryDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

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
    setCreating(false);
  }

  /** Same request and same row update as before; only *when* it runs changed — from the dialog's confirm
   * button, never from the table. */
  async function handleRevoke(target: TokenSummaryDto): Promise<void> {
    setRevokeError(null);
    setRevoking(true);
    try {
      await revokeCiToken(orgSlug, projectSlug, target.id);
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

  return (
    <div className={styles.screen}>
      <SectionHeader
        title="Tokens de CI"
        subtitle="La baseline oficial depende de la rama por defecto del proyecto y de un token de CI verificado por OIDC."
        actions={
          creating ? null : (
            <Button type="button" variant="primary" onClick={() => setCreating(true)}>
              Crear token
            </Button>
          )
        }
      />
      <FormError message={error} />
      {justCreated ? <TokenSecretPanel secret={justCreated.secret} onDismiss={() => setJustCreated(null)} /> : null}
      {creating ? <TokenCreateForm availableScopes={CI_TOKEN_SCOPES} onCreate={handleCreate} onCancel={() => setCreating(false)} /> : null}
      {!tokens ? <Skeleton rows={3} /> : <TokenTable tokens={tokens} onRevoke={askRevoke} />}

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revocar token"
        description="Deja de funcionar de inmediato. Si lo usa tu pipeline, vas a tener que generar uno nuevo y actualizar el secreto. No se puede deshacer."
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
