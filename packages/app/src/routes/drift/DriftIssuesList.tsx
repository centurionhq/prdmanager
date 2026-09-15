/** "Issues" grouped by kind, from Drift.dc.html (SDD-013, WO-361). */
import type { ReactElement, ReactNode } from 'react';
import type { DriftIssueDto } from '@prdm/contracts';
import { IdTag, Severity } from '../../components/index.js';
import { groupIssues, splitMessage } from './drift-groups.js';
import styles from './Drift.module.css';

function Message({ issue }: { readonly issue: DriftIssueDto }): ReactElement {
  return (
    <span>
      {splitMessage(issue.message).map((token, index) =>
        token.mono ? (
          // eslint-disable-next-line react/no-array-index-key -- tokens have no identity of their own
          <span key={index} className="id">
            {token.text}
          </span>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- tokens have no identity of their own
          <span key={index}>{token.text}</span>
        ),
      )}
    </span>
  );
}

function BlueprintCell({ issue }: { readonly issue: DriftIssueDto }): ReactNode {
  if (!issue.blueprintId) return null;
  return <IdTag id={issue.blueprintId} />;
}

export interface DriftIssuesListProps {
  readonly issues: readonly DriftIssueDto[];
}

export function DriftIssuesList({ issues }: DriftIssuesListProps): ReactElement {
  const groups = groupIssues(issues);

  if (groups.length === 0) {
    return <p>No hay drift pendiente de revisar.</p>;
  }

  return (
    <div>
      {groups.map((group) => (
        <div key={group.kind}>
          <div className={styles.groupHeader}>
            {group.label} <span className={styles.groupCount}>{group.issues.length}</span>
          </div>
          <ul className={styles.issueList}>
            {group.issues.map((issue) => (
              <li key={issue.id} className={styles.issueRow}>
                <Severity severity={issue.severity} />
                <Message issue={issue} />
                <span className={styles.issueBlueprint}>
                  <BlueprintCell issue={issue} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
