import type { ReactElement } from 'react';
import { getPerson, type CiToken } from '../../data';
import { formatDate, formatRelativeAccess } from './lib';
import styles from './TokensPage.module.css';

export interface TokensTableProps {
  readonly tokens: readonly CiToken[];
  readonly onRevoke: (token: CiToken) => void;
  readonly onDelete: (token: CiToken) => void;
}

function cellClass(expired: boolean, extra?: string): string {
  return [styles.cell, expired ? styles.muted : null, extra ?? null].filter(Boolean).join(' ');
}

function BranchValue({ branch, expired }: { readonly branch: string; readonly expired: boolean }): ReactElement {
  if (branch !== 'main') return <span>{branch}</span>;
  return <span className={`id ${expired ? styles.muted : ''}`}>{branch}</span>;
}

/** The CI tokens table: name/creator, prefix, scope chips, branch, expiry and last use (WO-306). */
export function TokensTable({ tokens, onRevoke, onDelete }: TokensTableProps): ReactElement {
  return (
    <table className={styles.table}>
      <caption className="visually-hidden">Tokens de CI</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.headerCell}>
            Nombre
          </th>
          <th scope="col" className={styles.headerCell}>
            Prefijo
          </th>
          <th scope="col" className={styles.headerCell}>
            Alcance
          </th>
          <th scope="col" className={styles.headerCell}>
            Rama
          </th>
          <th scope="col" className={styles.headerCell}>
            Vence
          </th>
          <th scope="col" className={styles.headerCell}>
            Último uso
          </th>
          <th scope="col" className={styles.headerCell}>
            <span className="visually-hidden">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((token) => {
          const creator = getPerson(token.createdBy)?.name ?? token.createdBy;
          return (
            <tr key={token.name} className={styles.row}>
              <td className={cellClass(token.expired, styles.nameCell)}>
                <span className={styles.tokenName}>{token.name}</span>
                <span className={`num ${styles.tokenMeta}`}>{`${creator}, ${formatDate(token.createdAt)}`}</span>
              </td>
              <td className={cellClass(token.expired)}>
                <span className={`id ${token.expired ? styles.muted : ''}`}>{`${token.prefix}…`}</span>
              </td>
              <td className={cellClass(token.expired, styles.scopeCell)}>
                {token.scopes.map((scope) => (
                  <span key={scope} className={`id ${styles.scopeChip}`}>
                    {scope}
                  </span>
                ))}
              </td>
              <td className={cellClass(token.expired)}>
                <BranchValue branch={token.branch} expired={token.expired} />
              </td>
              <td className={`${cellClass(token.expired)} num`}>
                {token.expired ? `Venció el ${formatDate(token.expiresAt)}` : formatDate(token.expiresAt)}
              </td>
              <td className={`${cellClass(token.expired)} num`}>
                {token.lastUsed ? formatRelativeAccess(token.lastUsed) : '—'}
              </td>
              <td className={cellClass(token.expired, styles.actionsCell)}>
                {token.expired ? (
                  <button type="button" className={styles.dangerLink} onClick={() => onDelete(token)}>
                    Eliminar
                  </button>
                ) : (
                  <button type="button" className={styles.dangerLink} onClick={() => onRevoke(token)}>
                    Revocar
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
