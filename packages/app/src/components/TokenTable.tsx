/**
 * The list of a person's or a project's tokens (SDD-056/PRD-036 R2, canvas `AjustesTokens.dc.html`), on the
 * design system's `DataTable`: sortable-ready, stacks under 640px, real `<table>` semantics. It only ever shows
 * what `TokenSummaryDto` carries -- never a secret or its hash -- and a revoked token offers no action.
 */
import type { ReactElement } from 'react';
import type { TokenSummaryDto } from '@prdm/contracts';
import { Button, DataTable, EmptyState, IdTag, type DataTableColumn } from './index.js';
import styles from './TokenTable.module.css';

const DATE_FORMAT = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

type TokenState = 'activo' | 'vencido' | 'revocado';

function stateOf(token: TokenSummaryDto): TokenState {
  if (token.revokedAt) return 'revocado';
  if (new Date(token.expiresAt).getTime() < Date.now()) return 'vencido';
  return 'activo';
}

const STATE_LABEL: Readonly<Record<TokenState, string>> = { activo: 'Activo', vencido: 'Vencido', revocado: 'Revocado' };

export function TokenTable({ tokens, onRevoke }: { tokens: TokenSummaryDto[]; onRevoke: (tokenId: string) => void }): ReactElement {
  if (tokens.length === 0) {
    return <EmptyState title="Todavía no hay tokens." body="Cuando crees uno, aparece acá con su alcance y su vencimiento." />;
  }

  const columns: readonly DataTableColumn<TokenSummaryDto>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (token) => (
        <span className={styles.name}>
          <span className={styles.nameMain}>{token.name}</span>
          <span className={styles.nameMeta}>{[token.createdByName, formatDate(token.createdAt)].filter(Boolean).join(', ')}</span>
        </span>
      ),
      sortValue: (token) => token.name,
    },
    { key: 'prefix', header: 'Prefijo', render: (token) => <IdTag id={token.prefix} tone="muted" /> },
    {
      key: 'scopes',
      header: 'Alcance',
      stack: 'block',
      render: (token) => (
        <span className={styles.scopes}>
          {token.scopes.map((scope) => (
            <span key={scope} className={`id ${styles.scope}`}>
              {scope}
            </span>
          ))}
        </span>
      ),
    },
    { key: 'expires', header: 'Vence', render: (token) => formatDate(token.expiresAt), sortValue: (token) => token.expiresAt },
    { key: 'used', header: 'Último uso', render: (token) => (token.lastUsedAt ? formatDate(token.lastUsedAt) : 'Sin usar') },
    { key: 'state', header: 'Estado', render: (token) => STATE_LABEL[stateOf(token)] },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'end',
      render: (token) =>
        token.revokedAt ? null : (
          <Button type="button" variant="destructive" size="sm" aria-label={`Revocar ${token.name}`} onClick={() => onRevoke(token.id)}>
            Revocar
          </Button>
        ),
    },
  ];

  return <DataTable caption="Tokens" columns={columns} rows={tokens} getRowId={(token) => token.id} />;
}
