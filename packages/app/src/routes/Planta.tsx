/**
 * `/o/:orgSlug/p/:projectSlug` index route (Centurion Factory "Planta", originally SDD-012, WO-354;
 * rebuilt on the design system with the seven-station line and BC/PRD row nesting by SDD-024/PRD-011,
 * WO-445): the line board (`getLineBoard`, now `LineBoard` — see `../components/LineBoard/LineBoard.tsx`)
 * plus the success-metrics KPI strip (`getMetrics`). See canvas/Main.dc.html — the sidebar itself is
 * `ProjectShell`'s own `AppShell`, unchanged by this WO; this route only renders the line and the strip.
 * SDD-094 (WO-720): the median KPI also carries the long tail — how many orders took more than a day and
 * its slowest ones, behind a drawer (canvas/PlantaBanda.dc.html).
 */
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { SuccessMetricsDto } from '@prdm/contracts';
import { getLineBoard, getMetrics } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery, type ApiQueryStatus } from '../api/use-api-query.js';
import { Drawer, EmptyState, ErrorState, LineBoard, PageHeader, Skeleton } from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { formatDateTime } from '../lib/format-date.js';
import { ProfileBand } from './inicio/ProfileBand.js';
import styles from './Planta.module.css';
import { useProjectShellContext } from './ProjectShell.js';

const PERCENT_FORMATTER = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function formatPercent(value: number | null): string {
  return value === null ? 'Sin datos' : `${PERCENT_FORMATTER.format(value)} %`;
}

function formatMedianResolution(hours: number | null): string {
  return hours === null ? 'Sin datos' : `${Math.round(hours * 60)} min`;
}

/** Mirrors core's `percent()`: no commits means "no data", not a fabricated 0 %. */
function formatCommitRefsPercent(traceability: SuccessMetricsDto['traceability']): string {
  return formatPercent(traceability.commitsTotal === 0 ? null : (traceability.commitsWithRefs / traceability.commitsTotal) * 100);
}

const COUNT_FORMATTER = new Intl.NumberFormat('es-AR');

type Efficiency = SuccessMetricsDto['agentHumanEfficiency'];
type UnmeasuredOrder = Efficiency['unmeasured']['workOrders'][number];

const UNMEASURED_REASON_COPY: Readonly<Record<string, string>> = {
  missing_claim: 'sin fecha de reclamo',
  missing_completion: 'sin fecha de cierre',
  invalid_timestamp: 'fecha inválida',
  negative_duration: 'cierre anterior al reclamo',
};

function formatInstant(iso: string | null): string {
  return iso === null ? '—' : formatDateTime(iso);
}

type Slowest = Efficiency['slowest'];
type SlowOrder = Slowest['items'][number];

const HOURS_PER_DAY = 24;
/** SDD-094 D5: one decimal for the orders' hours, and the same figure in days once they pass 48 h. */
const HOURS_FORMATTER = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatHours(hours: number): string {
  return hours >= HOURS_PER_DAY * 2 ? `${HOURS_FORMATTER.format(hours / HOURS_PER_DAY)} d` : `${HOURS_FORMATTER.format(hours)} h`;
}

/** SDD-094 D5: the threshold reads as copy, not as a raw number, and follows whatever the server sent. */
function slowThresholdCopy(thresholdHours: number): string {
  return thresholdHours === HOURS_PER_DAY ? 'más de un día' : `más de ${formatHours(thresholdHours)}`;
}

const QUEUE_DRAWER_WIDTH = 640;

interface SlowOrdersNoteProps {
  readonly efficiency: Efficiency;
  readonly orgSlug: string;
  readonly projectSlug: string;
}

/**
 * WO-720 (SDD-094 D4/D5): the long tail the median hides. Under the KPI's value, in secondary type, how many
 * completed orders took more than a day and which one was the worst; the control opens the existing `Drawer`
 * with the slowest ones. Read defensively like `UnmeasuredNote` (the response is not validated at runtime and
 * front/back deploy separately): no `slowest`, a non-numeric `total` or `total === 0` render nothing.
 */
function SlowOrdersNote({ efficiency, orgSlug, projectSlug }: SlowOrdersNoteProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const slowest = efficiency.slowest as Slowest | undefined;
  const total = slowest?.total;
  if (typeof total !== 'number' || !(total > 0)) return null;
  // Without the list the count is still known, so the line stays and the control goes away.
  const orders: readonly SlowOrder[] | null = Array.isArray(slowest?.items) ? (slowest.items as readonly SlowOrder[]) : null;
  const worst = orders?.[0];
  const threshold = slowThresholdCopy(typeof slowest?.thresholdHours === 'number' ? slowest.thresholdHours : HOURS_PER_DAY);
  const counted = total === 1 ? '1 orden tardó' : `${COUNT_FORMATTER.format(total)} órdenes tardaron`;

  return (
    <div className={styles.queueNote}>
      <p className={styles.queueLine}>
        {counted} {threshold}
        {worst ? `; la peor, ${worst.id} · ${formatHours(worst.resolutionHours)}` : ''}
      </p>
      {orders && worst ? (
        <>
          <button
            type="button"
            className={styles.queueControl}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(true)}
          >
            {total === 1 ? 'Ver la 1 orden' : `Ver las ${COUNT_FORMATTER.format(total)} órdenes`}
          </button>
          <Drawer open={open} title="Órdenes lentas" onClose={() => setOpen(false)} width={QUEUE_DRAWER_WIDTH}>
            <div id={panelId} className={styles.commitsBody}>
              <p>Órdenes completadas que tardaron {threshold} entre el reclamo y el cierre, de la más lenta a la más rápida.</p>
              <div className={styles.commitsScroll} tabIndex={0} role="group" aria-label="Órdenes de la lista">
                <table className={styles.commitsTable}>
                  <thead>
                    <tr>
                      <th scope="col">Orden</th>
                      <th scope="col">Reclamo</th>
                      <th scope="col">Cierre</th>
                      <th scope="col">Horas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <Link
                            className={`id ${styles.unmeasuredId}`}
                            to={`/o/${orgSlug}/p/${projectSlug}/ordenes?q=${encodeURIComponent(order.id)}`}
                          >
                            {order.id}
                          </Link>
                        </td>
                        <td>{formatInstant(order.claimedAt)}</td>
                        <td>{formatInstant(order.completedAt)}</td>
                        <td className="num">{formatHours(order.resolutionHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > orders.length ? (
                <p>
                  {orders.length === 1
                    ? `Se muestra la 1 más lenta de ${COUNT_FORMATTER.format(total)}.`
                    : `Se muestran las ${COUNT_FORMATTER.format(orders.length)} más lentas de ${COUNT_FORMATTER.format(total)}.`}
                </p>
              ) : null}
            </div>
          </Drawer>
        </>
      ) : null}
    </div>
  );
}

interface UnmeasuredNoteProps {
  readonly efficiency: Efficiency;
  readonly orgSlug: string;
  readonly projectSlug: string;
}

/**
 * WO-672 (SDD-081 D7): says how many completed orders the median leaves out and lists them. Read defensively
 * (the response is not validated at runtime and front/back deploy separately): no `unmeasured`, a non-numeric
 * `total` or `total === 0` render nothing; a missing list renders only the context line.
 */
function UnmeasuredNote({ efficiency, orgSlug, projectSlug }: UnmeasuredNoteProps): ReactElement | null {
  const unmeasured = efficiency.unmeasured as Efficiency['unmeasured'] | undefined;
  const total = unmeasured?.total;
  if (typeof total !== 'number' || !(total > 0)) return null;
  const orders: readonly UnmeasuredOrder[] | null = Array.isArray(unmeasured?.workOrders) ? unmeasured.workOrders : null;

  return (
    <>
      <span className={styles.kpiLabel}>
        {COUNT_FORMATTER.format(total)} de {COUNT_FORMATTER.format(efficiency.completedWorkOrders)} órdenes sin medición
      </span>
      {orders ? (
        <details className={styles.unmeasuredDetails}>
          <summary className={styles.unmeasuredSummary}>{total === 1 ? 'Ver la 1 orden' : `Ver las ${COUNT_FORMATTER.format(total)} órdenes`}</summary>
          <ul className={styles.unmeasuredList} aria-label="Órdenes sin medición">
            {orders.map((order) => (
              <li key={order.id} className={styles.unmeasuredRow}>
                <Link className={`id ${styles.unmeasuredId}`} to={`/o/${orgSlug}/p/${projectSlug}/documents/${encodeURIComponent(order.id)}`}>
                  {order.id}
                </Link>
                <span>{UNMEASURED_REASON_COPY[order.reason] ?? order.reason}</span>
                <span className={styles.unmeasuredDates}>
                  reclamo {formatInstant(order.claimedAt)} · cierre {formatInstant(order.completedAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

type UntracedCommits = SuccessMetricsDto['traceability']['untracedCommits'];
type UntracedCommit = UntracedCommits['items'][number];
type CommitKpiKind = 'with_refs' | 'traced';

const COMMIT_DRAWER_WIDTH = 640;
const SHORT_SHA_LENGTH = 7;

const COMMIT_DEFINITION: Readonly<Record<CommitKpiKind, string>> = {
  with_refs: 'Commits cuyo mensaje lleva el trailer Refs:; la lista son los que no lo llevan.',
  traced: 'Commits cuya ref resuelve la cadena hasta una feature (WO → Blueprint → Feature); la lista son los que no la resuelven.',
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * WO-669 (SDD-080 D6): the commit KPIs open their list only when the server sent one. The response is not
 * validated at runtime and front/back deploy separately, so a server older than WO-668 sends no
 * `untracedCommits`; then the KPI stays a plain number.
 */
function readUntracedCommits(traceability: SuccessMetricsDto['traceability']): UntracedCommits | null {
  const untraced = traceability.untracedCommits as UntracedCommits | undefined;
  return untraced && Array.isArray(untraced.items) ? untraced : null;
}

type CommitsWindow = SuccessMetricsDto['traceability']['commitsWindow'];
type CommitsByClass = UntracedCommits['byClass'];

/** The window once the three values are known to be present (see `readCommitsWindow`). */
interface ResolvedCommitsWindow {
  readonly branch: string;
  readonly sha: string;
  readonly reportedAt: string;
}

/** WO-723 (SDD-095 D7): the class is read as text in its own column, never colour alone. */
const COMMIT_CLASS_COPY: Readonly<Record<string, string>> = {
  merge: 'merge',
  bookkeeping: 'bookkeeping',
  code: 'código',
};

/**
 * WO-723 (SDD-095 D4): the window the commits were computed over. The response is not validated at runtime and
 * front/back deploy separately, so a server older than WO-722 sends no `commitsWindow`; when the field is absent,
 * or when any of the three values comes back null, there is no window to name and the UI says «ventana sin fecha»
 * instead of inventing a branch, a sha or a date.
 */
function readCommitsWindow(traceability: SuccessMetricsDto['traceability']): ResolvedCommitsWindow | null {
  const window = traceability.commitsWindow as Partial<CommitsWindow> | undefined;
  const branch = typeof window?.branch === 'string' ? window.branch : null;
  const sha = typeof window?.sha === 'string' ? window.sha : null;
  const reportedAt = typeof window?.reportedAt === 'string' ? window.reportedAt : null;
  if (branch === null || sha === null || reportedAt === null) return null;
  return { branch, sha, reportedAt };
}

/** `754 commits del reporte de main@1a2b3c4 del 06/10/2026, 12:00`, or the honest empty when there is no window. */
function formatCommitsWindow(commitsTotal: number, window: ResolvedCommitsWindow | null): string {
  if (window === null) return 'ventana sin fecha';
  return `${COUNT_FORMATTER.format(commitsTotal)} ${commitsTotal === 1 ? 'commit' : 'commits'} del reporte de ${window.branch}@${window.sha.slice(0, SHORT_SHA_LENGTH)} del ${formatDateTime(window.reportedAt)}`;
}

/**
 * WO-723 (SDD-095 D3/D6): the untraced gap broken down by class, computed by the server in the same aggregation
 * as `total`. Read defensively: without the numeric triple nothing is claimed -- the KPI omits the breakdown
 * instead of showing zeros it never received.
 */
function readByClass(untraced: UntracedCommits | null): CommitsByClass | null {
  const byClass = untraced?.byClass as Partial<CommitsByClass> | undefined;
  const { merge, bookkeeping, code } = byClass ?? {};
  if (typeof merge !== 'number' || typeof bookkeeping !== 'number' || typeof code !== 'number') return null;
  return { merge, bookkeeping, code };
}

interface CommitsScopeNoteProps {
  readonly commitsTotal: number;
  readonly window: ResolvedCommitsWindow | null;
  readonly byClass: CommitsByClass | null;
}

/**
 * WO-723 (SDD-095 D4/D6): declares the window the commits were computed over and how the untraced gap splits into
 * merges, bookkeeping and code, so a number that moves on every push is readable as "of what, and since when".
 */
function CommitsScopeNote({ commitsTotal, window, byClass }: CommitsScopeNoteProps): ReactElement {
  return (
    <span className={styles.kpiScope}>
      <span className={styles.kpiLabel}>{formatCommitsWindow(commitsTotal, window)}</span>
      {byClass === null ? null : (
        <span className={`num ${styles.kpiLabel}`}>
          {`${COUNT_FORMATTER.format(byClass.merge)} ${byClass.merge === 1 ? 'merge' : 'merges'}, ${COUNT_FORMATTER.format(byClass.bookkeeping)} bookkeeping, ${COUNT_FORMATTER.format(byClass.code)} de código`}
        </span>
      )}
    </span>
  );
}

interface CommitsKpiProps {
  readonly kind: CommitKpiKind;
  readonly label: string;
  readonly ratio: string;
  readonly percent: string;
  readonly commitsTotal: number;
  readonly untraced: UntracedCommits | null;
}

function CommitsKpi({ kind, label, ratio, percent, commitsTotal, untraced }: CommitsKpiProps): ReactElement {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (commitsTotal === 0) return <span className={`num ${styles.kpiValue}`}>Sin datos</span>;

  const missingRefs = untraced ? untraced.total - untraced.danglingRefs : 0;
  const hasList = untraced !== null && (kind === 'with_refs' ? missingRefs > 0 : untraced.total > 0);
  const rows = untraced === null ? [] : kind === 'with_refs' ? untraced.items.filter((item) => item.gap === 'no_refs') : untraced.items;

  return (
    <>
      {hasList ? (
        <button
          type="button"
          className={`num ${styles.kpiValue} ${styles.kpiControl}`}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${label}: ${ratio}`}
          onClick={() => setOpen(true)}
        >
          {ratio}
        </button>
      ) : (
        <span className={`num ${styles.kpiValue}`}>{ratio}</span>
      )}
      <span className={styles.kpiPercent}>{percent}</span>
      {hasList ? (
        <Drawer open={open} title={label} onClose={() => setOpen(false)} width={COMMIT_DRAWER_WIDTH}>
          <div id={panelId} className={styles.commitsBody}>
            <p>{COMMIT_DEFINITION[kind]}</p>
            <div className={styles.commitsCounts}>
              <p className="num">
                {kind === 'with_refs' ? `${missingRefs} de ${commitsTotal} commits sin el trailer Refs:` : `${untraced.total} de ${commitsTotal} commits sin trazar`}
              </p>
              {kind === 'traced' ? <p className="num">{plural(untraced.danglingRefs, 'ref colgante', 'refs colgantes')}</p> : null}
            </div>
            <p>Sólo las filas de clase código son trabajo; los merges y el bookkeeping no llevan Refs: por política.</p>
            {rows.length === 0 ? <p>No hay commits en esta lista.</p> : <CommitsTable rows={rows} />}
            {untraced.truncated ? <p>Se muestran los primeros {untraced.items.length} de {untraced.total}.</p> : null}
          </div>
        </Drawer>
      ) : null}
    </>
  );
}

function CommitsTable({ rows }: { readonly rows: readonly UntracedCommit[] }): ReactElement {
  return (
    <div className={styles.commitsScroll} tabIndex={0} role="group" aria-label="Commits de la lista">
      <table className={styles.commitsTable}>
        <thead>
          <tr>
            <th scope="col">Commit</th>
            <th scope="col">Clase</th>
            <th scope="col">Asunto</th>
            <th scope="col">Autor</th>
            <th scope="col">Fecha</th>
            <th scope="col">Archivos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sha}>
              <td>
                <span className="id">{row.sha.slice(0, SHORT_SHA_LENGTH)}</span>
                {row.gap === 'dangling_refs' ? <span className={styles.commitDangling}> ref colgante</span> : null}
              </td>
              <td>{COMMIT_CLASS_COPY[row.class] ?? row.class ?? '—'}</td>
              <td>{row.subject}</td>
              <td>{row.author}</td>
              <td>{formatDateTime(row.date)}</td>
              <td className="num">{plural(row.files.length, 'archivo', 'archivos')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface KpiStripProps {
  readonly metrics: SuccessMetricsDto | undefined;
  readonly status: ApiQueryStatus;
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly awaitingFirstReport: boolean;
  readonly orgSlug: string;
  readonly projectSlug: string;
}

/**
 * SDD-085 D2/D3: the strip owns its loading and failure (a failing `get_metrics` never takes the line down with
 * it) and, awaiting the first CI report, collapses into a single line that points at how to connect.
 */
function KpiStrip({ metrics, status, error, onRetry, awaitingFirstReport, orgSlug, projectSlug }: KpiStripProps): ReactElement {
  if (status === 'error') {
    return (
      <section aria-label="Indicadores de la planta" className={styles.kpiStrip}>
        <div className={styles.stripPlate}>
          <ErrorState title="No pudimos cargar los indicadores" body={errorMessage(error)} onRetry={onRetry} />
        </div>
      </section>
    );
  }
  if (status === 'cargando' || metrics === undefined) {
    return (
      <section aria-label="Indicadores de la planta" className={styles.kpiStrip}>
        <div className={styles.stripPlate}>
          <Skeleton rows={1} columns={5} />
        </div>
      </section>
    );
  }
  if (awaitingFirstReport) {
    return (
      <section aria-label="Indicadores de la planta" className={styles.kpiStrip}>
        <div className={styles.stripPlate}>
          <p className={styles.kpiFirstReport}>Todavía no hay reporte de CI: los indicadores llegan con el primero</p>
          <Link className={styles.kpiFirstReportLink} to={`/o/${orgSlug}/p/${projectSlug}/construir/developer`}>
            Conectar mi entorno
          </Link>
        </div>
      </section>
    );
  }
  return <KpiItems metrics={metrics} orgSlug={orgSlug} projectSlug={projectSlug} />;
}

interface KpiItemsProps {
  readonly metrics: SuccessMetricsDto;
  readonly orgSlug: string;
  readonly projectSlug: string;
}

function KpiItems({ metrics, orgSlug, projectSlug }: KpiItemsProps): ReactElement {
  const { featuresTotal, featuresTraced } = metrics.traceability;
  // SDD-079 D4: la invariante del servidor es featuresTraced + orphanFeatures.length === featuresTotal.
  // El faltante es la MISMA lista que filtra el Árbol, así que el número de acá y el del chip coinciden.
  // El frontend y el backend se despliegan por separado: `orphanFeatures` es requerido en el contrato,
  // pero la respuesta no se valida en runtime, así que un server anterior a WO-665 no lo manda. Se lee
  // defensivo: sin la lista no se puede afirmar cuánto falta, así que el KPI muestra sólo el ratio.
  const orphanFeatures = Array.isArray(metrics.traceability.orphanFeatures) ? metrics.traceability.orphanFeatures : null;
  const missing = orphanFeatures?.length ?? null;
  const ratio = `${featuresTraced}/${featuresTotal}`;
  const treeHref = `/o/${orgSlug}/p/${projectSlug}/arbol?sinCodigo=1`;

  const traced: { readonly value: ReactNode; readonly note: ReactNode } =
    featuresTotal === 0
      ? { value: <span className={`num ${styles.kpiValue}`}>Sin datos</span>, note: null }
      : missing === null
        ? { value: <span className={`num ${styles.kpiValue}`}>{ratio}</span>, note: null }
        : missing === 0
          ? { value: <span className={`num ${styles.kpiValue}`}>{ratio}</span>, note: <span className={styles.kpiLabel}>Todas trazadas</span> }
          : {
              value: (
                <Link className={`num ${styles.kpiValue}`} to={treeHref} aria-label={`${featuresTraced} de ${featuresTotal} features trazadas; faltan ${missing}`}>
                  {ratio}
                </Link>
              ),
              note: <span className={styles.kpiLabel}>faltan {missing}</span>,
            };

  const plain = (value: string): ReactNode => <span className={`num ${styles.kpiValue}`}>{value}</span>;
  const untraced = readUntracedCommits(metrics.traceability);
  const { commitsTotal } = metrics.traceability;
  const commitsWindow = readCommitsWindow(metrics.traceability);
  const commitsByClass = readByClass(untraced);
  const commitKpi = (kind: CommitKpiKind, label: string, count: number, percent: string): ReactNode => (
    <CommitsKpi kind={kind} label={label} ratio={`${count}/${commitsTotal}`} percent={percent} commitsTotal={commitsTotal} untraced={untraced} />
  );
  const items: { label: string; value: ReactNode; note: ReactNode }[] = [
    { label: 'Resolución mediana de una orden', value: plain(formatMedianResolution(metrics.agentHumanEfficiency.medianResolutionHours)), note: <><UnmeasuredNote efficiency={metrics.agentHumanEfficiency} orgSlug={orgSlug} projectSlug={projectSlug} /><SlowOrdersNote efficiency={metrics.agentHumanEfficiency} orgSlug={orgSlug} projectSlug={projectSlug} /></> },
    { label: 'Código sincronizado', value: plain(formatPercent(metrics.systemIntegrity.syncedPercent)), note: null },
    { label: 'Features trazadas', value: traced.value, note: traced.note },
    { label: 'Commits trazados', value: commitKpi('traced', 'Commits trazados', metrics.traceability.commitsTraced, formatPercent(metrics.traceability.commitPercent)), note: commitsTotal === 0 ? null : <CommitsScopeNote commitsTotal={commitsTotal} window={commitsWindow} byClass={commitsByClass} /> },
    { label: 'Commits con Refs', value: commitKpi('with_refs', 'Commits con Refs', metrics.traceability.commitsWithRefs, formatCommitRefsPercent(metrics.traceability)), note: null },
  ];

  return (
    <section aria-label="Indicadores de la planta" className={styles.kpiStrip}>
      {items.map((item) => (
        <div key={item.label} className={styles.kpiItem}>
          <span className={styles.kpiLabel}>{item.label}</span>
          {item.value}
          {item.note}
        </div>
      ))}
    </section>
  );
}

export function Planta(): ReactElement {
  const { orgSlug, projectSlug, project } = useProjectShellContext();
  useDocumentTitle('Planta');

  const lineBoardQuery = useApiQuery(
    `line-board:${orgSlug}:${projectSlug}`,
    () => getLineBoard(orgSlug, projectSlug),
    [orgSlug, projectSlug],
    (data) => data.features.length === 0,
  );
  const metricsQuery = useApiQuery(`metrics:${orgSlug}:${projectSlug}`, () => getMetrics(orgSlug, projectSlug), [orgSlug, projectSlug], () => false);

  return (
    <div>
      <PageHeader title="Planta" />

      {/* SDD-051: the entry band depends only on the shell's context, never on the line's data, so it is
          always there -- including while the line loads, if it fails, and above the empty state, which is
          exactly when someone most needs to be told where to start. */}
      <ProfileBand />

      {lineBoardQuery.status === 'cargando' ? <Skeleton rows={6} /> : null}

      {lineBoardQuery.status === 'error' ? <ErrorState title="No pudimos cargar la planta" body={errorMessage(lineBoardQuery.error)} onRetry={lineBoardQuery.retry} /> : null}

      {lineBoardQuery.status === 'vacio' ? <EmptyState title="Todavía no hay features en la línea" /> : null}

      {lineBoardQuery.data && lineBoardQuery.status !== 'vacio' ? (
        <div className={styles.page}>
          <LineBoard orgSlug={orgSlug} projectSlug={projectSlug} lineBoard={lineBoardQuery.data} />
          <KpiStrip
            metrics={metricsQuery.data}
            status={metricsQuery.status}
            error={metricsQuery.error}
            onRetry={metricsQuery.retry}
            awaitingFirstReport={project.awaitingFirstReport}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
          />
        </div>
      ) : null}
    </div>
  );
}
