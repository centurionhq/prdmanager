import { X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import { IdTag, Severity } from '../../components';
import buttonStyles from '../../components/Button/Button.module.css';
import type { DriftIssue } from '../../data';
import { actionForIssue, groupIssues, splitMessage } from './drift-issue-groups';
import styles from './DriftIssuesList.module.css';

function Message({ issue }: { readonly issue: DriftIssue }): ReactElement {
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

function BlueprintCell({ issue }: { readonly issue: DriftIssue }): ReactNode {
  if (!issue.blueprintId) return <span className={styles.blueprintCell}>Sin blueprint</span>;
  return <IdTag id={issue.blueprintId} />;
}

function ActionCell({ issue }: { readonly issue: DriftIssue }): ReactNode {
  const action = actionForIssue(issue);
  if (!action) return null;
  return (
    <Link
      to={action.to}
      className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.sm} ${styles.actionButton}`}
    >
      {action.label}
    </Link>
  );
}

export interface DriftIssuesListProps {
  readonly issues: readonly DriftIssue[];
  readonly featureId: string | null;
  readonly onClearFeature: () => void;
}

/** "Issues" grouped by kind, from canvas/Drift.dc.html, with the ?feature= filter chip (WO-294). */
export function DriftIssuesList({ issues, featureId, onClearFeature }: DriftIssuesListProps): ReactElement {
  const groups = groupIssues(issues);

  return (
    <div className={styles.section}>
      <h2 className={styles.title}>Issues</h2>
      {featureId ? (
        <button type="button" className={styles.filterChip} onClick={onClearFeature}>
          Feature {featureId}
          <span className={styles.filterChipRemove}>
            <X aria-hidden="true" size={14} />
          </span>
        </button>
      ) : null}

      {groups.length === 0 ? <p className={styles.emptyMessage}>No hay issues para este filtro.</p> : null}

      {groups.map((group) => (
        <div key={group.kind} className={styles.group}>
          <div className={styles.groupHeader}>
            {group.label} <span className={`${styles.groupCount} num`}>{group.issues.length}</span>
          </div>
          <ul className={styles.list}>
            {group.issues.map((issue) => (
              <li key={issue.id} className={styles.row}>
                <Severity severity={issue.severity} />
                <Message issue={issue} />
                <BlueprintCell issue={issue} />
                <span className={styles.actionCell}>
                  <ActionCell issue={issue} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
