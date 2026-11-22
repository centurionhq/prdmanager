/** "Issues" grouped by kind, from Drift.dc.html (SDD-013, WO-361). */
import { useState, type ReactElement, type ReactNode } from 'react';
import type { DriftIssueDto } from '@prdm/contracts';
import { Button, IdTag, Severity, Tooltip } from '../../components/index.js';
import { acknowledgeTargetFor, groupIssues, PAGE_SIZE, paginateIssues, splitMessage, type AcknowledgeTarget } from './drift-groups.js';
import { issueCopy, REASON_LABELS, type GlossaryTerm, type IssueCopy } from './drift-issue-copy.js';
import styles from './Drift.module.css';

/**
 * Rows whose document cannot be acknowledged from the row itself (SDD-111 D4). Acknowledge is per document, and
 * a work order row does not carry the document the server needs — its blueprint's subgroup does.
 */
const NO_ROW_TARGET_TIP =
  'Esta fila no se reconoce sola. «Reconocer» avanza la línea base de un documento entero: usá el subgrupo de su blueprint o «Todo el proyecto».';

function issueNoun(count: number): string {
  return count === 1 ? 'issue' : 'issues';
}

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
  /** Every acknowledgeable document plus "Todo el proyecto" — the same list the modal's select shows. */
  readonly ackTargets: readonly AcknowledgeTarget[];
  /** `can(subject, 'acknowledge_drift')`: without it no action is rendered at all (SDD-111 D7). */
  readonly canAcknowledge: boolean;
  /** Target whose acknowledge is in flight; its buttons say «Reconociendo…» and cannot be sent twice. */
  readonly acknowledging?: string | null;
  /** The list never calls the API itself: it asks the screen to open the modal on this target. */
  readonly onAcknowledgeRequest: (target: string) => void;
}

export function DriftIssuesList({
  issues,
  ackTargets,
  canAcknowledge,
  acknowledging = null,
  onAcknowledgeRequest,
}: DriftIssuesListProps): ReactElement {
  const groups = groupIssues(issues);
  const [visibleBySubgroup, setVisibleBySubgroup] = useState<Record<string, number>>({});
  const options = new Map(ackTargets.map((target) => [target.value, target]));

  /** The action lives in a native `<summary>`: without both calls the click would also toggle the `<details>`. */
  function requestAcknowledge(event: { preventDefault: () => void; stopPropagation: () => void }, target: string): void {
    event.preventDefault();
    event.stopPropagation();
    onAcknowledgeRequest(target);
  }

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
              // One subgroup is one document, so its action covers the document's whole debt — all kinds of
              // issues, not only the ones of this group (SDD-111 D5).
              const subgroupTarget = subgroup.blueprintId ? options.get(subgroup.blueprintId) : undefined;
              const action = canAcknowledge ? subgroupTarget : undefined;
              return (
                <details key={key} open className={styles.subgroup}>
                  <summary className={styles.subgroupHeader}>
                    {subgroup.blueprintId ? (
                      <IdTag id={subgroup.blueprintId} />
                    ) : (
                      <span className={styles.subgroupLabel}>{subgroup.label}</span>
                    )}
                    <span className={styles.groupCount}>{subgroup.issues.length}</span>
                    {action ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className={styles.subgroupAction}
                        disabled={acknowledging === action.value}
                        aria-label={`Reconocer ${action.count === 1 ? 'el issue' : `los ${action.count} issues`} de ${action.value}`}
                        onClick={(event) => requestAcknowledge(event, action.value)}
                      >
                        {acknowledging === action.value
                          ? 'Reconociendo…'
                          : action.count === 1
                            ? 'Reconocer'
                            : `Reconocer los ${action.count} issues`}
                      </Button>
                    ) : null}
                  </summary>
                  <ul className={styles.issueList}>
                    {paginated.visible.map((issue) => {
                      const copy = issueCopy(issue);
                      const rowTarget = acknowledgeTargetFor(issue);
                      const rowAction = canAcknowledge && rowTarget ? options.get(rowTarget) : undefined;
                      return (
                        // The tip explains, without inventing an action, why this row offers none (SDD-111 D4).
                        <li
                          key={issue.id}
                          className={styles.issueRow}
                          title={canAcknowledge && !rowAction ? NO_ROW_TARGET_TIP : undefined}
                        >
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
                          {rowAction ? (
                            <span className={styles.issueAck}>
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={acknowledging === rowAction.value}
                                // A row never suggests it acknowledges one issue: it carries the document's count.
                                aria-label={`Reconocer ${rowAction.value}: cubre ${rowAction.count} ${issueNoun(rowAction.count)}`}
                                onClick={() => onAcknowledgeRequest(rowAction.value)}
                              >
                                {acknowledging === rowAction.value ? (
                                  'Reconociendo…'
                                ) : (
                                  <>
                                    Reconocer <span className={styles.issueAckCount}>{rowAction.count}</span>
                                  </>
                                )}
                              </Button>
                            </span>
                          ) : null}
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
