/** "Validación" side panel tab (WO-290): each issue's severity, field and message. */
import type { ReactElement } from 'react';
import { Severity } from '../../components';
import type { ValidationIssue } from '../../data';
import styles from './ValidationTab.module.css';

export interface ValidationTabProps {
  readonly issues: readonly ValidationIssue[];
}

export function ValidationTab({ issues }: ValidationTabProps): ReactElement {
  if (issues.length === 0) return <p>Sin problemas de validación.</p>;

  return (
    <ul className={styles.list}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={styles.row}>
          <Severity severity={issue.severity} />
          {issue.field ? <span className="id">{issue.field}</span> : null}
          <p className={styles.message}>{issue.message}</p>
        </li>
      ))}
    </ul>
  );
}
