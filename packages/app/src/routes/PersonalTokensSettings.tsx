/**
 * `/settings/tokens` (SDD-006 §Modelo de datos / §Permisos "Scopes de tokens", WO-119): personal API
 * tokens. Not nested under `/o/:orgSlug` (SDD-006 lists it as a top-level dashboard route), but every
 * personal-token route is still org-scoped server-side (`packages/server/src/api/tokens.ts`'s documented
 * deviation) — this screen carries its own organization picker rather than relying on `OrgShell`.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { CreatedTokenResponse, OrganizationSummary, TokenScopeDto, TokenSummaryDto } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { createPersonalToken, listOrganizations, listPersonalTokens, revokePersonalToken } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { PERSONAL_TOKEN_SCOPES } from '../auth/token-scopes.js';
import { FormError } from '../components/FormError.js';
import { TokenCreateForm } from '../components/TokenCreateForm.js';
import { TokenSecretPanel } from '../components/TokenSecretPanel.js';
import { TokenTable } from '../components/TokenTable.js';
import dashboardStyles from '../styles/dashboard.module.css';
import styles from '../styles/forms.module.css';

export function PersonalTokensSettings(): ReactElement {
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedTokenResponse | null>(null);

  useEffect(() => {
    listOrganizations()
      .then((orgs) => {
        setOrganizations(orgs);
        setOrgSlug((prev) => prev ?? orgs[0]?.slug ?? null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (!orgSlug) return;
    setTokens(null);
    listPersonalTokens(orgSlug)
      .then(setTokens)
      .catch((err) => setError(errorMessage(err)));
  }, [orgSlug]);

  async function handleCreate(input: { name: string; scopes: TokenScopeDto[]; expiresAt: string }): Promise<void> {
    if (!orgSlug) return;
    const result = await createPersonalToken(orgSlug, input);
    setJustCreated(result);
    setTokens((prev) => [...(prev ?? []), result.token]);
  }

  async function handleRevoke(tokenId: string): Promise<void> {
    if (!orgSlug) return;
    try {
      await revokePersonalToken(orgSlug, tokenId);
      setTokens((prev) => (prev ?? []).map((t) => (t.id === tokenId ? { ...t, revokedAt: new Date().toISOString() } : t)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (error) return <FormError message={error} />;
  if (!organizations) return <LoadingState label="Cargando…" />;
  if (organizations.length === 0) {
    return <p className={styles.hint}>Necesitás pertenecer a una organización para crear tokens personales.</p>;
  }

  return (
    <div className={dashboardStyles.content}>
      <h1 className={styles.title}>Tokens personales</h1>
      <div className={styles.field}>
        <label htmlFor="tokens-org">Organización</label>
        <select id="tokens-org" value={orgSlug ?? ''} onChange={(e) => setOrgSlug(e.target.value)}>
          {organizations.map((org) => (
            <option key={org.id} value={org.slug}>
              {org.name}
            </option>
          ))}
        </select>
      </div>

      {justCreated && <TokenSecretPanel secret={justCreated.secret} onDismiss={() => setJustCreated(null)} />}

      {!tokens ? <LoadingState label="Cargando tokens…" /> : <TokenTable tokens={tokens} onRevoke={(id) => void handleRevoke(id)} />}

      <TokenCreateForm availableScopes={PERSONAL_TOKEN_SCOPES} onCreate={handleCreate} />
    </div>
  );
}
