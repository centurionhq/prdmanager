/** "Issues" grouped by kind, from Drift.dc.html (SDD-013, WO-361). */
import { useState, type ReactElement, type ReactNode } from 'react';
import type { DriftIssueDto } from '@prdm/contracts';
import { Button, IdTag, Severity } from '../../components/index.js';
import { groupIssues, PAGE_SIZE, paginateIssues, splitMessage } from './drift-groups.js';
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
  const [visibleBySubgroup, setVisibleBySubgroup] = useState<Record<string, number>>({});

  if (groups.length === 0) {
    return <p>No hay drift pendiente de revisar.</p>;
  }

  return (
    <div>
      {groups.map((group) => {
        const groupCount = group.subgroups.reduce((n, s) => n + s.issues.length, 0);
        return (
          <details key={group.kind} open className={styles.group}>
            <summary className={styles.groupHeader}>
              <span>{group.label}</span>
              <span className={styles.groupCount}>{groupCount}</span>
            </summary>
            {group.subgroups.map((subgroup) => {
              const key = `${group.kind}/${subgroup.blueprintId ?? 'none'}`;
              const requested = visibleBySubgroup[key] ?? PAGE_SIZE;
              const paginated = paginateIssues(subgroup.issues, Math.min(requested, subgroup.issues.length));
              return (
                <details key={key} open className={styles.subgroup}>
                  <summary className={styles.subgroupHeader}>
                    {subgroup.blueprintId ? (
                      <IdTag id={subgroup.blueprintId} />
                    ) : (
                      <span className={styles.subgroupLabel}>{subgroup.label}</span>
                    )}
                    <span className={styles.groupCount}>{subgroup.issues.length}</span>
                  </summary>
                  <ul className={styles.issueList}>
                    {paginated.visible.map((issue) => (
                      <li key={issue.id} className={styles.issueRow}>
                        <Severity severity={issue.severity} />
                        <Message issue={issue} />
                        <span className={styles.issueBlueprint}>
                          <BlueprintCell issue={issue} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  {paginated.remaining > 0 && (
                    <div className={styles.showMore}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setVisibleBySubgroup((previous) => ({
                            ...previous,
                            [key]: paginated.visible.length + PAGE_SIZE,
                          }))
                        }
                      >
                        Mostrar {PAGE_SIZE} más (quedan {paginated.remaining})
                      </Button>
                    </div>
                  )}
                </details>
              );
            })}
          </details>
        );
      })}
    </div>
  );
}
