/** One code report's own issue list (SDD-013, WO-361): `getDriftReportDetail`, not just the count the
 * history row already shows. Opened from a history row or a preview branch. */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { DriftIssueDto, DriftReportDetailDto } from '@prdm/contracts';
import { getDriftReportDetail } from '../../api/client.js';
import { errorMessage } from '../../api/error-message.js';
import { ErrorState, Modal, Severity, Skeleton, Tooltip } from '../../components/index.js';
import { splitMessage } from './drift-groups.js';
import { issueCopy, REASON_LABELS, type GlossaryTerm, type IssueCopy } from './drift-issue-copy.js';
import { branchDisplay } from './previews.js';
import styles from './ReportDetailModal.module.css';

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

export interface ReportDetailModalProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly reportId: string | undefined;
  /** `project.settings.github_repository`, only used to link the branch label (SDD-070 D7): the modal never
   * fetches the project, and with no repository the label stays plain text instead of a broken link. */
  readonly githubRepository: string | null;
  readonly onClose: () => void;
}

/**
 * SDD-070 D7: the report's branch leads the meta, readably (`PR #32` for `32/merge`) and linked to GitHub
 * only when the project knows its own repository — `branchDisplay` owns both rules, the same ones the
 * preview rows use, so the modal and the panel can never disagree about a branch.
 */
function ReportMeta({
  detail,
  githubRepository,
}: {
  readonly detail: DriftReportDetailDto;
  readonly githubRepository: string | null;
}): ReactElement {
  const display = branchDisplay(detail.branch, githubRepository);
  return (
    <p className={styles.meta}>
      {display.href !== null ? (
        <a href={display.href} target="_blank" rel="noopener noreferrer" title={display.title}>
          {display.label}
        </a>
      ) : (
        <span title={display.title}>{display.label}</span>
      )}{' '}
      · <span className="id">{detail.headSha.slice(0, 12)}</span> · {detail.tokenName} · {detail.issueCount}{' '}
      {detail.issueCount === 1 ? 'issue' : 'issues'}
    </p>
  );
}

export function ReportDetailModal({ orgSlug, projectSlug, reportId, githubRepository, onClose }: ReportDetailModalProps): ReactElement {
  const [detail, setDetail] = useState<DriftReportDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    if (!reportId) return;
    setDetail(null);
    setError(null);
    getDriftReportDetail(orgSlug, projectSlug, reportId)
      .then(setDetail)
      .catch((err: unknown) => setError(errorMessage(err)));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` closes over its own deps only.
  }, [orgSlug, projectSlug, reportId]);

  return (
    <Modal open={Boolean(reportId)} onClose={onClose} title="Detalle del reporte">
      {error ? <ErrorState title="No pudimos cargar el reporte" body={error} onRetry={load} /> : null}
      {!detail && !error ? <Skeleton rows={4} /> : null}
      {detail ? (
        <>
          <ReportMeta detail={detail} githubRepository={githubRepository} />
          {detail.issues.length === 0 ? (
            <p className={styles.empty}>Este reporte no encontró issues.</p>
          ) : (
            <ul className={styles.list}>
              {detail.issues.map((issue) => {
                const copy = issueCopy(issue);
                return (
                  <li key={issue.id} className={styles.row}>
                    <Severity severity={issue.severity} />
                    <div className={styles.issueBody}>
                      <Headline issue={issue} copy={copy} />
                      {copy.action !== null ? <div className={styles.issueAction}>Qué hacer: {copy.action}</div> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </Modal>
  );
}
