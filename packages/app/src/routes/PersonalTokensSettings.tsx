/**
 * `/settings/tokens` (SDD-006 §Modelo de datos / §Permisos "Scopes de tokens", WO-119): personal API
 * tokens. Not nested under `/o/:orgSlug` (SDD-006 lists it as a top-level dashboard route), but every
 * personal-token route is still org-scoped server-side (`packages/server/src/api/tokens.ts`'s documented
 * deviation) — this screen carries its own organization picker rather than relying on `OrgShell`.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { CreatedTokenResponse, OrganizationSummary, TokenScopeDto, TokenSummaryDto } from '@prdm/contracts';
import { createPersonalToken, listOrganizations, listPersonalTokens, revokePersonalToken } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { PERSONAL_TOKEN_SCOPES } from '../auth/token-scopes.js';
import { Button, Notice, SectionHeader, SelectField, Skeleton } from '../components/index.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { TokenCreateForm } from '../components/TokenCreateForm.js';
import { TokenSecretPanel } from '../components/TokenSecretPanel.js';
import { TokenTable } from '../components/TokenTable.js';
import styles from './TokensScreen.module.css';

export function PersonalTokensSettings(): ReactElement {
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedTokenResponse | null>(null);
  const [creating, setCreating] = useState(false);
  useDocumentTitle('Tokens personales');

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
    setCreating(false);
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
  if (!organizations) return <Skeleton rows={3} />;
  if (organizations.length === 0) {
    return <Notice>Necesitás pertenecer a una organización para crear tokens personales.</Notice>;
  }

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

      <div className={styles.orgPicker}>
        <SelectField label="Organización" value={orgSlug ?? ''} onChange={setOrgSlug} options={organizations.map((org) => ({ value: org.slug, label: org.name }))} />
      </div>

      {justCreated ? <TokenSecretPanel secret={justCreated.secret} onDismiss={() => setJustCreated(null)} /> : null}
      {creating ? <TokenCreateForm availableScopes={PERSONAL_TOKEN_SCOPES} onCreate={handleCreate} onCancel={() => setCreating(false)} /> : null}
      {!tokens ? <Skeleton rows={3} /> : <TokenTable tokens={tokens} onRevoke={(id) => void handleRevoke(id)} />}
    </div>
  );
}
