/**
 * `/o/:orgSlug/p/:projectSlug/drift` (SDD-013 §"Shell y router", WO-361): the code-report-backed drift
 * view — reporte oficial de la rama por defecto, vistas previas por rama, historial completo y el
 * detalle de un reporte (`getDriftReportDetail`), con "Reconocer drift" (`acknowledgeDrift`). Ported
 * from the old graph/`getDriftDashboard`-only screen to also drive `getDriftIssues` (SDD-012, WO-340),
 * the same feature/blueprint/station-attributed issues `Drift.dc.html` shows.
 */
import { useState, type ReactElement } from 'react';
import { can } from '@prdm/contracts';
import { getDriftDashboard, getDriftIssues } from '../api/client.js';
import { acknowledgeDrift, authorizeForcePushOverride } from '../api/graph.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import { Button, ErrorState, PageHeader, Severity, Skeleton, ToastProvider, useToast } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import { AcknowledgeModal } from './drift/AcknowledgeModal.js';
import { acknowledgeableTargets } from './drift/drift-groups.js';
import { DriftIssuesList } from './drift/DriftIssuesList.js';
import { ForcePushOverrideModal } from './drift/ForcePushOverrideModal.js';
import { ReportDetailModal } from './drift/ReportDetailModal.js';
import styles from './drift/Drift.module.css';

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

function DriftContent(): ReactElement {
  const { orgSlug, projectSlug, subject } = useProjectShellContext();
  useDocumentTitle('Drift');
  const { show } = useToast();

  const dashboardQuery = useApiQuery(`drift-dashboard:${orgSlug}:${projectSlug}`, () => getDriftDashboard(orgSlug, projectSlug), [orgSlug, projectSlug]);
  const issuesQuery = useApiQuery(`drift-issues:${orgSlug}:${projectSlug}`, () => getDriftIssues(orgSlug, projectSlug), [orgSlug, projectSlug]);

  const [ackOpen, setAckOpen] = useState(false);
  const [ackSubmitting, setAckSubmitting] = useState(false);
  const [reportId, setReportId] = useState<string | undefined>(undefined);
  const [forcePushOpen, setForcePushOpen] = useState(false);
  const [forcePushSubmitting, setForcePushSubmitting] = useState(false);

  if (dashboardQuery.status === 'cargando' || issuesQuery.status === 'cargando') return <Skeleton rows={6} />;
  if (dashboardQuery.status === 'error') {
    return <ErrorState title="No pudimos cargar el drift" body={errorMessage(dashboardQuery.error)} onRetry={dashboardQuery.retry} />;
  }
  if (issuesQuery.status === 'error') {
    return <ErrorState title="No pudimos cargar los issues de drift" body={errorMessage(issuesQuery.error)} onRetry={issuesQuery.retry} />;
  }

  const dashboard = dashboardQuery.data ?? { official: null, previews: [], history: [] };
  const issues = issuesQuery.data ?? [];
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const targets = acknowledgeableTargets(issues);

  async function handleAcknowledge(target: string): Promise<void> {
    setAckSubmitting(true);
    try {
      await acknowledgeDrift(orgSlug, projectSlug, target);
      setAckOpen(false);
      show('Drift reconocido', { tone: 'success' });
      dashboardQuery.retry();
      issuesQuery.retry();
    } catch (err) {
      show(errorMessage(err));
    } finally {
      setAckSubmitting(false);
    }
  }

  async function handleForcePushOverride(headSha: string): Promise<void> {
    setForcePushSubmitting(true);
    try {
      await authorizeForcePushOverride(orgSlug, projectSlug, headSha);
      setForcePushOpen(false);
      show('Force-push autorizado', { tone: 'success' });
    } catch (err) {
      show(errorMessage(err));
    } finally {
      setForcePushSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Drift"
        subtitle={
          dashboard.official ? (
            <>
              Reporte oficial de <span className="id">{dashboard.official.branch ?? '(rama desconocida)'}</span> · commit{' '}
              <span className="id">{shortSha(dashboard.official.headSha)}</span> · {formatTimestamp(dashboard.official.createdAt)}
            </>
          ) : (
            'Todavía no hay un reporte oficial verificado por CI para este proyecto.'
          )
        }
        actions={
          <div className={styles.headerActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={!can(subject, 'manage_ci_tokens')}
              title={can(subject, 'manage_ci_tokens') ? undefined : 'Requiere admin'}
              onClick={() => setForcePushOpen(true)}
            >
              Autorizar force-push
            </Button>
            <Button type="button" variant="primary" onClick={() => setAckOpen(true)}>
              Reconocer drift
            </Button>
          </div>
        }
      />

      {!dashboard.official ? (
        <div className={styles.awaitingOfficial}>
          <Severity severity="warning" />
          <span>Esperando el primer reporte de CI verificado sobre la rama por defecto.</span>
        </div>
      ) : null}

      <section className={styles.summary} aria-label="Resumen de drift">
        <div className={styles.summaryItem}>
          <div className={styles.summaryHeadline}>
            <span className={`${styles.summaryDot} ${styles.dotError}`} aria-hidden="true" />
            <span className={styles.summaryCount}>{errorCount}</span>
            <span className={styles.summaryUnit}>errores</span>
          </div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryHeadline}>
            <span className={`${styles.summaryDot} ${styles.dotWarning}`} aria-hidden="true" />
            <span className={styles.summaryCount}>{warningCount}</span>
            <span className={styles.summaryUnit}>avisos</span>
          </div>
        </div>
      </section>

      <div className={styles.columns}>
        <div>
          <h2 className={styles.sectionTitle}>Issues</h2>
          <DriftIssuesList issues={issues} />
        </div>

        <div className={styles.sidebar}>
          <div>
            <h2 className={styles.sectionTitle}>Previews por rama</h2>
            {dashboard.previews.length === 0 ? (
              <p>No hay reportes de vista previa todavía.</p>
            ) : (
              <>
                <div className={styles.previewsHead}>
                  <span>Rama</span>
                  <span>Issues</span>
                </div>
                <ul className={styles.list}>
                  {dashboard.previews.map((report) => (
                    <li key={report.id} className={styles.previewRow}>
                      <div className={styles.branchInfo}>
                        <span className="id">{report.branch ?? '(rama desconocida)'}</span>
                        <span className={styles.previewBadge}>vista previa</span>
                      </div>
                      <span className={[styles.issueCount, report.issueCount === 0 ? styles.issueCountZero : styles.issueCountSome].join(' ')}>
                        {report.issueCount}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div>
            <h2 className={styles.sectionTitle}>Historial</h2>
            {dashboard.history.length === 0 ? (
              <p>Todavía no se reportó ningún código para este proyecto.</p>
            ) : (
              <table className={styles.historyTable}>
                <caption className="visually-hidden">Historial de reportes de drift, del más reciente al más antiguo.</caption>
                <thead>
                  <tr>
                    <th scope="col" className={styles.historyHeaderCell}>
                      Fecha
                    </th>
                    <th scope="col" className={styles.historyHeaderCell}>
                      Commit
                    </th>
                    <th scope="col" className={styles.historyHeaderCell}>
                      Token
                    </th>
                    <th scope="col" className={`${styles.historyHeaderCell} ${styles.historyHeaderCellEnd}`}>
                      Issues
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.history.map((report) => (
                    <tr
                      key={report.id}
                      className={styles.historyRow}
                      tabIndex={0}
                      onClick={() => setReportId(report.id)}
                      onKeyDown={(event) => {
                        if (!isActivationKey(event.key)) return;
                        event.preventDefault();
                        setReportId(report.id);
                      }}
                    >
                      <td className={styles.historyCell}>{formatDate(report.createdAt)}</td>
                      <td className={styles.historyCell}>
                        <span className="id">{shortSha(report.headSha)}</span>
                      </td>
                      <td className={styles.historyCell}>{report.tokenName}</td>
                      <td className={`${styles.historyCell} ${styles.historyCellEnd}`}>{report.issueCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <AcknowledgeModal
        open={ackOpen}
        targets={targets}
        submitting={ackSubmitting}
        onClose={() => setAckOpen(false)}
        onConfirm={(target) => void handleAcknowledge(target)}
      />
      <ReportDetailModal orgSlug={orgSlug} projectSlug={projectSlug} reportId={reportId} onClose={() => setReportId(undefined)} />
      <ForcePushOverrideModal
        open={forcePushOpen}
        submitting={forcePushSubmitting}
        onClose={() => setForcePushOpen(false)}
        onConfirm={(headSha) => void handleForcePushOverride(headSha)}
      />
    </div>
  );
}

export function DriftDashboard(): ReactElement {
  return (
    <ToastProvider>
      <DriftContent />
    </ToastProvider>
  );
}
