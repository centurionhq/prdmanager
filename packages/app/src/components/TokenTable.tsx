/**
 * Shared read-only-plus-revoke table for both the personal-token screen and the per-project CI-token
 * section (SDD-006 §Modelo de datos: `tokenSummarySchema` — name, prefix, scopes, expiry, last use,
 * revoked status; never a secret).
 */
import type { ReactElement } from 'react';
import type { TokenSummaryDto } from '@prdm/contracts';
import styles from '../styles/forms.module.css';

function statusOf(token: TokenSummaryDto): string {
  if (token.revokedAt) return 'revocado';
  if (new Date(token.expiresAt).getTime() < Date.now()) return 'vencido';
  return 'activo';
}

export function TokenTable({ tokens, onRevoke }: { tokens: TokenSummaryDto[]; onRevoke: (tokenId: string) => void }): ReactElement {
  if (tokens.length === 0) {
    return <p className={styles.hint}>Todavía no hay tokens.</p>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Prefijo</th>
            <th>Scopes</th>
            <th>Vence</th>
            <th>Último uso</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id}>
              <td>{token.name}</td>
              <td>
                <code>{token.prefix}</code>
              </td>
              <td>{token.scopes.join(', ')}</td>
              <td>{token.expiresAt}</td>
              <td>{token.lastUsedAt ?? '—'}</td>
              <td>{statusOf(token)}</td>
              <td>
                {!token.revokedAt && (
                  <button type="button" className={styles.secondaryButton} onClick={() => onRevoke(token.id)}>
                    Revocar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
