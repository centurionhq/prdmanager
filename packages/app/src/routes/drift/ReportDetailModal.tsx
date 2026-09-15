/** One code report's own issue list (SDD-013, WO-361): `getDriftReportDetail`, not just the count the
 * history row already shows. Opened from a history row or a preview branch. */
import { useEffect, useState, type ReactElement } from 'react';
import type { DriftReportDetailDto } from '@prdm/contracts';
import { getDriftReportDetail } from '../../api/client.js';
import { errorMessage } from '../../api/error-message.js';
import { ErrorState, Modal, Severity, Skeleton } from '../../components/index.js';
import styles from './ReportDetailModal.module.css';

export interface ReportDetailModalProps {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly reportId: string | undefined;
  readonly onClose: () => void;
}

export function ReportDetailModal({ orgSlug, projectSlug, reportId, onClose }: ReportDetailModalProps): ReactElement {
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
          <p className={styles.meta}>
            <span className="id">{detail.headSha.slice(0, 12)}</span> · {detail.tokenName} · {detail.issueCount} {detail.issueCount === 1 ? 'issue' : 'issues'}
          </p>
          {detail.issues.length === 0 ? (
            <p className={styles.empty}>Este reporte no encontró issues.</p>
          ) : (
            <ul className={styles.list}>
              {detail.issues.map((issue) => (
                <li key={issue.id} className={styles.row}>
                  <Severity severity={issue.severity} />
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </Modal>
  );
}
