/**
 * `/o/:orgSlug/p/:projectSlug/drift` (SDD-013 §"Shell y router", WO-361): the code-report-backed drift
 * view — reporte oficial de la rama por defecto, vistas previas por rama, historial completo y el
 * detalle de un reporte (`getDriftReportDetail`), con "Reconocer drift" (`acknowledgeDrift`). Ported
 * from the old graph/`getDriftDashboard`-only screen to also drive `getDriftIssues` (SDD-012, WO-340),
 * the same feature/blueprint/station-attributed issues `Drift.dc.html` shows.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { can } from '@prdm/contracts';
import { getDriftDashboard, getDriftIssues } from '../api/client.js';
import { acknowledgeDrift, authorizeForcePushOverride } from '../api/graph.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import { Button, ErrorState, FilterChips, PageHeader, SearchField, SelectField, Severity, ShaRef, Skeleton, ToastProvider, Tooltip, useToast } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { formatDateTime } from '../lib/format-date.js';
import { useProjectShellContext } from './ProjectShell.js';
import { AcknowledgeModal } from './drift/AcknowledgeModal.js';
import { EMPTY_FILTERS, PROJECT_TARGET, acknowledgeableTargets, filterIssues, groupIssues, type DriftFilters } from './drift/drift-groups.js';
import { DriftIssuesList } from './drift/DriftIssuesList.js';
import { ForcePushOverrideModal } from './drift/ForcePushOverrideModal.js';
import { PreviewsByBranch } from './drift/PreviewsByBranch.js';
import { ReportDetailModal } from './drift/ReportDetailModal.js';
import { reportFreshness } from './drift/report-freshness.js';
import styles from './drift/Drift.module.css';

const BLUEPRINT_TIP = 'Un blueprint (SDD/ADR) es el diseño técnico que gobierna qué archivos y símbolos deben coincidir con él.';
const REASON_TIP =
  'La razón la reporta el motor: el archivo cambió, el archivo ya no existe, cambió el diseño después de este código o cambió la feature.';
const REFRESH_REPORT_TITLE = 'Vuelve a leer el último reporte de CI; no dispara una corrida nueva.';

function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

/** The history row is a click target of its own, and its commit cell now holds a copy button and a link
 * (WO-635): acting on those must not also open the report detail. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('a, button') !== null;
}

function DriftContent(): ReactElement {
  const { orgSlug, projectSlug, project, subject } = useProjectShellContext();
  useDocumentTitle('Drift');
  const { show } = useToast();
  // The commit links are the project's own repository or nothing at all: a guessed URL would be a broken link.
  const repository = project.settings.github_repository;

  const dashboardQuery = useApiQuery(`drift-dashboard:${orgSlug}:${projectSlug}`, () => getDriftDashboard(orgSlug, projectSlug), [orgSlug, projectSlug]);
  const issuesQuery = useApiQuery(`drift-issues:${orgSlug}:${projectSlug}`, () => getDriftIssues(orgSlug, projectSlug), [orgSlug, projectSlug]);

  const [ackOpen, setAckOpen] = useState(false);
  const [ackSubmitting, setAckSubmitting] = useState(false);
  const [reportId, setReportId] = useState<string | undefined>(undefined);
  const [forcePushOpen, setForcePushOpen] = useState(false);
  const [forcePushSubmitting, setForcePushSubmitting] = useState(false);
  const [refreshingReport, setRefreshingReport] = useState(false);
  const [filters, setFilters] = useState<DriftFilters>(EMPTY_FILTERS);
  const issues = issuesQuery.data ?? [];
  const filtered = useMemo(() => filterIssues(issues, filters), [issues, filters]);

  if (dashboardQuery.status === 'cargando' || issuesQuery.status === 'cargando') return <Skeleton rows={6} />;
  if (dashboardQuery.status === 'error') {
    return <ErrorState title="No pudimos cargar el drift" body={errorMessage(dashboardQuery.error)} onRetry={dashboardQuery.retry} />;
  }
  if (issuesQuery.status === 'error') {
    return <ErrorState title="No pudimos cargar los issues de drift" body={errorMessage(issuesQuery.error)} onRetry={issuesQuery.retry} />;
  }

  const dashboard = dashboardQuery.data ?? { official: null, previews: [], history: [] };
  const official = dashboard.official;
  const freshness = official ? reportFreshness(official.createdAt) : null;
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const targets = acknowledgeableTargets(issues);
  const hasActiveFilters =
    filters.severity !== 'all' || filters.kind !== 'all' || filters.blueprintId !== 'all' || filters.query.trim() !== '';

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

  /**
   * Re-reads the last CI report. It never asks CI for a new run — it only reads what CI already pushed, so no
   * report timestamp on screen comes from this action (SDD-069 D1: a refetch does not rejuvenate a report).
   * `retry()` alone cannot be awaited (SDD-013's hook bumps a tick and returns void), so the handler awaits the
   * same two reads to keep the button disabled until the data is actually back, then re-runs both queries so
   * the visible data and the session cache come from the hook's own cycle.
   */
  async function handleRefreshReport(): Promise<void> {
    setRefreshingReport(true);
    try {
      await Promise.all([getDriftDashboard(orgSlug, projectSlug), getDriftIssues(orgSlug, projectSlug)]);
      dashboardQuery.retry();
      issuesQuery.retry();
      show('Reporte releído', { tone: 'success' });
    } catch (err) {
      show(errorMessage(err));
    } finally {
      setRefreshingReport(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Drift"
        subtitle={
          official && freshness ? (
            <>
              Reporte oficial de <span className="id">{official.branch ?? '(rama desconocida)'}</span> · commit{' '}
              <ShaRef sha={official.headSha} repository={repository} /> ·{' '}
              <Tooltip text={freshness.absolute}>
                <span>{freshness.relative}</span>
              </Tooltip>
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
              disabled={refreshingReport}
              title={REFRESH_REPORT_TITLE}
              aria-label={REFRESH_REPORT_TITLE}
              onClick={() => void handleRefreshReport()}
            >
              Actualizar reporte
            </Button>
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

      {!official ? (
        <div className={styles.awaitingOfficial}>
          <Severity severity="warning" />
          <span>Esperando el primer reporte de CI verificado sobre la rama por defecto.</span>
        </div>
      ) : null}

      {official && freshness?.stale ? (
        <div className={styles.awaitingOfficial}>
          <Severity severity="warning" />
          <span>
            El reporte oficial tiene {freshness.days} días ({freshness.absolute}). Los números pueden no reflejar el código
            actual: se renueva cuando CI reporta un push sobre {official.branch ?? '(rama desconocida)'}.
          </span>
        </div>
      ) : null}

      <section className={styles.summary} aria-label="Resumen de drift">
        <button
          type="button"
          aria-pressed={filters.severity === 'error'}
          className={[styles.summaryItem, styles.kpiButton, filters.severity === 'error' ? styles.kpiSelected : null].filter(Boolean).join(' ')}
          onClick={() => setFilters((f) => ({ ...f, severity: f.severity === 'error' ? 'all' : 'error' }))}
        >
          <div className={styles.summaryHeadline}>
            <span className={`${styles.summaryDot} ${styles.dotError}`} aria-hidden="true" />
            <span className={styles.summaryCount}>{errorCount}</span>
            <span className={styles.summaryUnit}>errores</span>
          </div>
        </button>
        <button
          type="button"
          aria-pressed={filters.severity === 'warning'}
          className={[styles.summaryItem, styles.kpiButton, filters.severity === 'warning' ? `${styles.kpiSelected} ${styles.kpiSelectedWarning}` : null]
            .filter(Boolean)
            .join(' ')}
          onClick={() => setFilters((f) => ({ ...f, severity: f.severity === 'warning' ? 'all' : 'warning' }))}
        >
          <div className={styles.summaryHeadline}>
            <span className={`${styles.summaryDot} ${styles.dotWarning}`} aria-hidden="true" />
            <span className={styles.summaryCount}>{warningCount}</span>
            <span className={styles.summaryUnit}>avisos</span>
          </div>
        </button>
      </section>

      <div className={styles.columns}>
        <div>
          <h2 className={styles.sectionTitle}>Issues</h2>
          <p className={styles.legend}>
            Un <Tooltip text={BLUEPRINT_TIP}><span>blueprint</span></Tooltip> (
            <Tooltip text={BLUEPRINT_TIP}><span className="id">SDD-00N</span></Tooltip>) es el diseño que gobierna ese código. Cada fila dice qué
            pasó y qué hacer; pasá el mouse por la{' '}
            <Tooltip text={REASON_TIP}><span>razón</span></Tooltip> para ver el detalle.
          </p>
          <div className={styles.filters} role="group" aria-label="Filtros de drift">
            <div className={styles.filterControls}>
              <FilterChips
                label="Severidad"
                value={filters.severity}
                onChange={(severity) => setFilters((f) => ({ ...f, severity: severity as DriftFilters['severity'] }))}
                options={[
                  { value: 'all', label: 'Todas', count: issues.length },
                  { value: 'error', label: 'Errores', count: errorCount },
                  { value: 'warning', label: 'Avisos', count: warningCount },
                ]}
              />
              <FilterChips
                label="Tipo"
                value={filters.kind}
                onChange={(kind) => setFilters((f) => ({ ...f, kind }))}
                options={[
                  { value: 'all', label: 'Todas', count: issues.length },
                  ...groupIssues(issues).map((g) => ({
                    value: g.kind,
                    label: g.label,
                    count: g.subgroups.reduce((n, s) => n + s.issues.length, 0),
                  })),
                ]}
              />
              <SelectField
                label="Blueprint"
                value={filters.blueprintId}
                onChange={(blueprintId) => setFilters((f) => ({ ...f, blueprintId }))}
                options={[
                  { value: 'all', label: 'Todos los blueprints' },
                  ...targets.filter((t) => t.value !== PROJECT_TARGET).map((t) => ({ value: t.value, label: t.label })),
                ]}
              />
              <SearchField
                label="Buscar en los issues"
                value={filters.query}
                placeholder="id, ruta o mensaje"
                onChange={(query) => setFilters((f) => ({ ...f, query }))}
              />
            </div>
            <div className={styles.filterFooter}>
              <span className={styles.filterSummary}>
                {filtered.length} de {issues.length} issues
              </span>
              {hasActiveFilters ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Limpiar filtros
                </Button>
              ) : null}
            </div>
          </div>
          <div className={styles.issuesList} role="region" aria-label="Issues de drift">
            <DriftIssuesList issues={filtered} />
          </div>
        </div>

        <div className={styles.sidebar}>
          <PreviewsByBranch
            previews={dashboard.previews}
            official={dashboard.official}
            defaultBranch={project.settings.default_branch}
            githubRepository={project.settings.github_repository}
            onOpenReport={setReportId}
          />

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
                      onClick={(event) => {
                        if (isInteractiveTarget(event.target)) return;
                        setReportId(report.id);
                      }}
                      onKeyDown={(event) => {
                        if (!isActivationKey(event.key) || isInteractiveTarget(event.target)) return;
                        event.preventDefault();
                        setReportId(report.id);
                      }}
                    >
                      <td className={styles.historyCell}>{formatDateTime(report.createdAt)}</td>
                      <td className={styles.historyCell}>
                        <ShaRef sha={report.headSha} repository={repository} />
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
      <ReportDetailModal
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        reportId={reportId}
        githubRepository={project.settings.github_repository}
        onClose={() => setReportId(undefined)}
      />
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
