/** "Issues" grouped by kind, from Drift.dc.html (SDD-013, WO-361). */
import { useState, type ReactElement, type ReactNode } from 'react';
import type { DriftIssueDto } from '@prdm/contracts';
import { Button, IdTag, Severity, Tooltip } from '../../components/index.js';
import { groupIssues, PAGE_SIZE, paginateIssues, splitMessage } from './drift-groups.js';
import { issueCopy, REASON_LABELS, type GlossaryTerm, type IssueCopy } from './drift-issue-copy.js';
import styles from './Drift.module.css';

function blueprintTipFor(issue: DriftIssueDto, copy: IssueCopy): string | undefined {
  if (!issue.blueprintId) return undefined;
  return copy.glossary.find((t) => t.term === issue.blueprintId)?.tip;
}

function reasonGlossary(issue: DriftIssueDto, copy: IssueCopy): GlossaryTerm | undefined {
  return copy.glossary.find((t) => t.term !== issue.blueprintId);
}

/** A plain token split around the reason phrase, wrapping only the phrase in its tooltip. */
function reasonParts(text: string, label: string, tip: string): ReactNode {
  const at = text.indexOf(label);
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <Tooltip text={tip}>
        <span>{label}</span>
      </Tooltip>
      {text.slice(at + label.length)}
    </>
  );
}

function Headline({ issue, copy }: { readonly issue: DriftIssueDto; readonly copy: IssueCopy }): ReactElement {
  const tokens = copy.tokens.length > 0 ? copy.tokens : splitMessage(issue.message);
  const blueprintTip = blueprintTipFor(issue, copy);
  const reason = reasonGlossary(issue, copy);
  const reasonLabel = reason ? REASON_LABELS[reason.term] : undefined;
  return (
    <span>
      {tokens.map((token, index) => {
        if (token.mono) {
          const id = <span className="id">{token.text}</span>;
          return token.text === issue.blueprintId && blueprintTip ? (
            // eslint-disable-next-line react/no-array-index-key -- tokens have no identity of their own
            <Tooltip key={index} text={blueprintTip}>
              {id}
            </Tooltip>
          ) : (
            // eslint-disable-next-line react/no-array-index-key -- tokens have no identity of their own
            <span key={index} className="id">
              {token.text}
            </span>
          );
        }
        return (
          // eslint-disable-next-line react/no-array-index-key -- tokens have no identity of their own
          <span key={index}>{reason && reasonLabel ? reasonParts(token.text, reasonLabel, reason.tip) : token.text}</span>
        );
      })}
    </span>
  );
}

function BlueprintCell({ issue, tip }: { readonly issue: DriftIssueDto; readonly tip?: string }): ReactNode {
  if (!issue.blueprintId) return null;
  const tag = <IdTag id={issue.blueprintId} />;
  return tip ? <Tooltip text={tip}>{tag}</Tooltip> : tag;
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
                    {paginated.visible.map((issue) => {
                      const copy = issueCopy(issue);
                      return (
                        <li key={issue.id} className={styles.issueRow}>
                          <Severity severity={issue.severity} />
                          <div className={styles.issueBody}>
                            <span className={styles.issueHeadline}>
                              <Headline issue={issue} copy={copy} />
                              <span className={styles.issueBlueprint}>
                                <BlueprintCell issue={issue} tip={blueprintTipFor(issue, copy)} />
                              </span>
                            </span>
                            {copy.action !== null ? <div className={styles.issueAction}>Qué hacer: {copy.action}</div> : null}
                          </div>
                        </li>
                      );
                    })}
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
