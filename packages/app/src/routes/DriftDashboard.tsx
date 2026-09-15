/**
 * `/o/:orgSlug/p/:projectSlug/drift` (SDD-010 §Dashboard, WO-199): the code-report-backed drift view —
 * distinct from `ProjectGraph`'s blueprint/work-order `DriftBanner` (that one reflects
 * `PgProjectEngine.inspect()` directly; this one is "who verified what, and when", straight from the
 * `code_reports` history WO-180/WO-181 already write).
 *
 * Three sections, per SDD-010: the **official** report for the default branch (never a preview shown as
 * if it were official — the label is always explicit text, never color alone, per this codebase's
 * earlier UI/a11y review gate), **preview** drift by branch, and the full chronological **history**.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router';
import type { DriftDashboardDto, DriftReportSummaryDto } from '@prdm/contracts';
import { LoadingState } from '@prdm/ui';
import { getDriftDashboard } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useOrgShellContext } from './OrgShell.js';
import formStyles from '../styles/forms.module.css';
import styles from '../styles/drift-dashboard.module.css';

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

/** Text-labelled badge — SDD-006's earlier a11y review gate ruled out color-only status indicators, so
 * "Oficial"/"Vista previa" is always the actual accessible name, with color only as reinforcement. */
function ModeBadge({ mode }: { mode: DriftReportSummaryDto['mode'] }): ReactElement {
  const label = mode === 'baseline' ? 'Oficial' : 'Vista previa';
  return <span className={`${styles.badge} ${mode === 'baseline' ? styles.badgeOfficial : styles.badgePreview}`}>{label}</span>;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function OfficialSection({ official }: { official: DriftReportSummaryDto | null }): ReactElement {
  return (
    <section className={styles.section} aria-labelledby="drift-official-heading">
      <h2 id="drift-official-heading" className={styles.sectionTitle}>
        Rama por defecto (oficial)
      </h2>
      {!official && <p className={styles.empty}>Todavía no hay un reporte oficial verificado por CI para este proyecto.</p>}
      {official && (
        <div className={styles.officialCard}>
          <p>
            <ModeBadge mode="baseline" /> verificado por el token <strong>{official.tokenName}</strong>
          </p>
          <p>
            Commit <span className={styles.sha}>{shortSha(official.headSha)}</span>
          </p>
          <p className={styles.meta}>
            {official.issueCount} {official.issueCount === 1 ? 'issue' : 'issues'}
            {official.hasBlockingIssues ? ' (bloqueantes)' : ''} · {formatTimestamp(official.createdAt)}
          </p>
        </div>
      )}
    </section>
  );
}

function PreviewsSection({ previews }: { previews: DriftReportSummaryDto[] }): ReactElement {
  return (
    <section className={styles.section} aria-labelledby="drift-previews-heading">
      <h2 id="drift-previews-heading" className={styles.sectionTitle}>
        Vistas previas por rama
      </h2>
      {previews.length === 0 && <p className={styles.empty}>No hay reportes de vista previa todavía.</p>}
      {previews.length > 0 && (
        <ul>
          {previews.map((report) => (
            <li key={report.id}>
              <ModeBadge mode="preview" /> <strong>{report.branch ?? '(rama desconocida)'}</strong> · <span className={styles.sha}>{shortSha(report.headSha)}</span> ·{' '}
              {report.tokenName} · {report.issueCount} {report.issueCount === 1 ? 'issue' : 'issues'} · {formatTimestamp(report.createdAt)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HistorySection({ history }: { history: DriftReportSummaryDto[] }): ReactElement {
  return (
    <section className={styles.section} aria-labelledby="drift-history-heading">
      <h2 id="drift-history-heading" className={styles.sectionTitle}>
        Historial de reportes
      </h2>
      {history.length === 0 && <p className={styles.empty}>Todavía no se reportó ningún código para este proyecto.</p>}
      {history.length > 0 && (
        <div className={formStyles.tableWrap}>
          <table className={formStyles.table}>
            <caption className={formStyles.hint}>Reportes de código, oficiales y de vista previa, del más reciente al más antiguo.</caption>
            <thead>
              <tr>
                <th scope="col">Nivel de confianza</th>
                <th scope="col">Rama</th>
                <th scope="col">Commit</th>
                <th scope="col">Token</th>
                <th scope="col">Issues</th>
                <th scope="col">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {history.map((report) => (
                <tr key={report.id}>
                  <td>
                    <ModeBadge mode={report.mode} />
                  </td>
                  <td>{report.branch ?? '(rama desconocida)'}</td>
                  <td className={styles.sha}>{shortSha(report.headSha)}</td>
                  <td>{report.tokenName}</td>
                  <td>
                    {report.issueCount}
                    {report.hasBlockingIssues ? ' (bloqueantes)' : ''}
                  </td>
                  <td>{formatTimestamp(report.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function DriftDashboard(): ReactElement {
  const { orgSlug } = useOrgShellContext();
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [dashboard, setDashboard] = useState<DriftDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('Drift');

  useEffect(() => {
    if (!projectSlug) return;
    let cancelled = false;
    setDashboard(null);
    setError(null);
    getDriftDashboard(orgSlug, projectSlug)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, projectSlug]);

  if (!projectSlug) return <LoadingState label="Cargando drift…" />;

  return (
    <div>
      <h1 className={formStyles.title}>Drift</h1>
      <FormError message={error} />
      {!dashboard && !error && <LoadingState label="Cargando drift…" />}
      {dashboard && (
        <>
          <OfficialSection official={dashboard.official} />
          <PreviewsSection previews={dashboard.previews} />
          <HistorySection history={dashboard.history} />
        </>
      )}
    </div>
  );
}
