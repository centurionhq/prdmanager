/** CreateTokenModal's "Alcance" checkbox list. */
import type { ReactElement } from 'react';
import type { TokenScope } from '../../data';
import styles from './TokensPage.module.css';

const SCOPE_OPTIONS: readonly TokenScope[] = ['reports:write', 'reports:baseline', 'governance:read', 'mcp:read'];

export interface TokenScopeFieldsetProps {
  readonly scopes: readonly TokenScope[];
  readonly onToggle: (scope: TokenScope) => void;
}

export function TokenScopeFieldset({ scopes, onToggle }: TokenScopeFieldsetProps): ReactElement {
  return (
    <fieldset className={`${styles.fieldGroup} ${styles.fieldset}`}>
      <legend className={styles.label}>Alcance</legend>
      <div className={styles.scopeList}>
        {SCOPE_OPTIONS.map((scope) => (
          <label key={scope} className={styles.scopeOption}>
            <input type="checkbox" checked={scopes.includes(scope)} onChange={() => onToggle(scope)} />
            <span className="id">{scope}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
