/**
 * `/o/:orgSlug` index route (Centurion Factory "Proyectos", SDD-012/SDD-013, WO-353): every project the
 * caller can see in this org, from `getProjectsOverview` — richer than the old `listProjects`-backed
 * grid (line status, drift, orders in progress, role, last activity). See canvas/Proyectos.dc.html; the
 * top bar itself is `OrgShell`'s own header, unchanged by this WO.
 */
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router';
import { ChevronDown } from 'lucide-react';
import {
  PROJECT_ROLES,
  PROJECT_SLUG_PATTERN,
  STATIONS,
  can,
  projectNameSchema,
  projectSlugSchema,
  type CreateProjectInput,
  type ProjectOverviewDto,
  type PermissionSubject,
  type ProjectRole,
  type Station,
} from '@prdm/contracts';
import { archiveProject, createProject, getProjectsOverview, unarchiveProject } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiMutation } from '../api/use-api-mutation.js';
import { useApiQuery } from '../api/use-api-query.js';
import { isOrgAdmin } from '../auth/org-role.js';
import { projectRoleLabel } from '../lib/role-labels.js';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FilterChips,
  Modal,
  PageHeader,
  SearchField,
  Skeleton,
  ToastProvider,
  useToast,
  type DataTableColumn,
} from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { filterItems, searchItems, sortItems, type SortState } from '../lib/filter-sort.js';
import { reportFreshness } from './drift/report-freshness.js';
import { useOrgShellContext } from './OrgShell.js';
import styles from './ProjectsDashboard.module.css';

const STATION_LABELS: Record<Station, string> = {
  entrada: 'Entrada',
  caso_negocio: 'Caso de negocio',
  producto: 'Producto',
  diseno_tecnico: 'Diseño técnico',
  planificacion: 'Planificación',
  construccion: 'Construcción',
  entregado: 'Entregado',
};

type ProjectFilter = 'active' | 'archived' | 'all';
type LineFilter = 'all' | 'stopped' | 'drift' | 'awaiting';

const PROJECT_FILTER_LABELS: Record<ProjectFilter, string> = { active: 'Activos', archived: 'Archivados', all: 'Todos' };
const LINE_FILTER_LABELS: Record<LineFilter, string> = { all: 'Todos', stopped: 'Detenidos', drift: 'Con drift', awaiting: 'Esperando CI' };

function stationPosition(station: Station): number {
  return STATIONS.indexOf(station) + 1;
}

/**
 * The stage a line can claim to have reached, as a 1-based position in `STATIONS` (`0`: it never advanced).
 *
 * FB-237 / SDD-101 D3: a stopped line cannot have reached a station past its stop. Capping the reached stage
 * at the one right before the andon is what stops the cell from saying "Llegó a Entregado, detenida en Diseño
 * técnico" — two facts that contradict each other. Pure and parameter-in only, so its own test walks every
 * edge (first station, stop ahead of the furthest stage, no andon).
 */
export function reachedPosition(project: Pick<ProjectOverviewDto, 'furthestStation' | 'andonStation'>): number {
  const furthest = stationPosition(project.furthestStation);
  if (!project.andonStation) return furthest;
  return Math.min(furthest, stationPosition(project.andonStation) - 1);
}

/** FB-237 / SDD-101 D3: the line sentence names the stage it reached *and* where it stopped, never two
 * contradictory stages. Approved copy: "Llegó a <estación anterior>, detenida en <parada>". */
export function lineLabel(project: Pick<ProjectOverviewDto, 'furthestStation' | 'andonStation'>): string {
  const reached = reachedPosition(project);
  if (!project.andonStation) return `Llega a ${STATION_LABELS[project.furthestStation]}`;
  const stoppedAt = STATION_LABELS[project.andonStation];
  const reachedStation = STATIONS[reached - 1];
  if (!reachedStation) return `Se detuvo en ${stoppedAt}`;
  return `Llegó a ${STATION_LABELS[reachedStation]}, detenida en ${stoppedAt}`;
}

/** SDD-101 D4: the age of the evidence that flagged the stop, never an invented stop date — the graph does
 * not store when the line stopped, so the cell says how old the report behind the number is. */
function lineEvidence(project: ProjectOverviewDto): string {
  return project.lastReportAt ? `Último reporte ${reportFreshness(project.lastReportAt).relative}` : 'Sin reporte de código';
}

function segmentLabel(station: Station, position: number, reached: number, andonAt: number): string {
  if (position === andonAt) return `Detenida en ${STATION_LABELS[station]}`;
  return `${STATION_LABELS[station]} · ${position <= reached ? 'alcanzada' : 'pendiente'}`;
}

function segmentClass(position: number, reached: number, andonAt: number): string {
  if (position === andonAt) return `${styles.segment} ${styles.segmentStopped}`;
  return position <= reached ? `${styles.segment} ${styles.segmentReached}` : styles.segment!;
}

function LineStatus({ project, orgSlug }: { readonly project: ProjectOverviewDto; readonly orgSlug: string }): ReactElement {
  const reached = reachedPosition(project);
  const andonAt = project.andonStation ? stationPosition(project.andonStation) : 0;

  const text = <span className={styles.lineText}>{lineLabel(project)}</span>;
  const segments = (
    <span className={styles.segments}>
      {STATIONS.map((station, index) => {
        const position = index + 1;
        return <span key={station} role="img" aria-label={segmentLabel(station, position, reached, andonAt)} className={segmentClass(position, reached, andonAt)} />;
      })}
    </span>
  );

  // FB-240 / SDD-101 D2: with an andon the cell is the way to the blocker, the same `drift?feature=` destination
  // the Planta already uses. Without one it stays plain text — there is nothing to unblock.
  const feature = project.andonFeature;
  if (!feature) {
    return (
      <span className={styles.lineCell}>
        {text}
        {segments}
      </span>
    );
  }

  const evidence = lineEvidence(project);
  return (
    <span className={styles.lineCell}>
      <Link
        to={`/o/${orgSlug}/p/${project.slug}/drift?feature=${encodeURIComponent(feature.id)}`}
        className={styles.lineLink}
        aria-label={`${lineLabel(project)}. ${evidence}. La frena ${feature.id}: ${feature.title}. Ver qué la frena.`}
      >
        {text}
        {segments}
        <span className={styles.lineEvidence}>
          {evidence} · Ver qué la frena
        </span>
      </Link>
    </span>
  );
}

type DriftTone = 'error' | 'warning' | 'awaiting' | 'ok';

function driftTone(project: ProjectOverviewDto): DriftTone {
  if (project.driftErrors > 0) return 'error';
  if (project.driftWarnings > 0) return 'warning';
  if (project.awaitingFirstReport) return 'awaiting';
  return 'ok';
}

function driftLabel(project: ProjectOverviewDto): string {
  const errors = project.driftErrors > 0 ? `${project.driftErrors} ${project.driftErrors === 1 ? 'error' : 'errores'}` : null;
  const warnings = project.driftWarnings > 0 ? `${project.driftWarnings} ${project.driftWarnings === 1 ? 'aviso' : 'avisos'}` : null;
  if (errors || warnings) return [errors, warnings].filter(Boolean).join(' · ');
  return project.awaitingFirstReport ? 'Esperando primer reporte de CI' : 'Sin drift';
}

const DRIFT_TEXT_CLASS: Record<DriftTone, string | undefined> = {
  error: styles.driftError,
  warning: styles.driftWarning,
  awaiting: styles.driftAwaiting,
  ok: styles.driftOk,
};

const DRIFT_MARK_CLASS: Record<Exclude<DriftTone, 'awaiting'>, string | undefined> = {
  error: styles.markError,
  warning: styles.markWarning,
  ok: styles.markOk,
};

function DriftCell({ project, orgSlug }: { readonly project: ProjectOverviewDto; readonly orgSlug: string }): ReactElement {
  const tone = driftTone(project);
  const className = [styles.cellLink, DRIFT_TEXT_CLASS[tone], tone === 'awaiting' ? undefined : styles.driftStrong].filter(Boolean).join(' ');
  return (
    <Link to={`/o/${orgSlug}/p/${project.slug}/drift`} className={className}>
      {tone === 'awaiting' ? null : <span aria-hidden="true" className={`${styles.mark} ${DRIFT_MARK_CLASS[tone]}`} />}
      {driftLabel(project)}
    </Link>
  );
}

interface AccessCellProps {
  readonly project: ProjectOverviewDto;
  readonly orgSlug: string;
  /** `can(..., 'manage_members')` for this row — SDD-101 D6 / SDD-078 D2: the alarm is for everyone who can see
   * the project, the action only for whoever can actually add a member. The server rejects it regardless. */
  readonly canManageMembers: boolean;
}

function AccessCell({ project, orgSlug, canManageMembers }: AccessCellProps): ReactElement {
  const members = project.memberCount ?? 0;
  const href = `/o/${orgSlug}/p/${project.slug}/ajustes/miembros`;
  if (members > 0) {
    return (
      <Link to={href} className={`${styles.cellLink} num`}>
        {`${members} ${members === 1 ? 'miembro' : 'miembros'}`}
      </Link>
    );
  }

  // FB-241 / SDD-101 D6: the most serious warning in the table gets a non-chromatic marker (the same mechanism
  // as the stopped segment: a shape, not just a colour), the consequence in words and the next step. It stays a
  // link to the members screen. `role="status"`, never `role="alert"`: with N rows, N live alerts would be noise
  // — the view-level alert is reserved for real failures.
  const label = canManageMembers
    ? `Sin miembros: nadie del equipo ve ${project.name}. Agregar miembros.`
    : `Sin miembros: nadie del equipo ve ${project.name}.`;
  return (
    <span role="status" className={styles.accessAlarm}>
      <span aria-hidden="true" className={styles.accessMark} />
      <Link to={href} className={`${styles.cellLink} ${styles.accessLink}`} aria-label={label}>
        <span className={styles.accessText}>Nadie del equipo lo ve</span>
        {canManageMembers ? <span className={styles.accessAction}>Agregar miembros</span> : null}
      </Link>
    </span>
  );
}

/** FB-242 / SDD-101 D7: the legend starts collapsed, remembers its state and never hides the title or the
 * keyboard path to it. `aria-expanded` + `aria-controls` on a real button, body rendered only when open. */
export const LEGEND_OPEN_STORAGE_KEY = 'prdm.projects.legend-open';

/** The browser storage the preference lives in: `localStorage` when it exists (a real visit keeps it across
 * days), `sessionStorage` in environments that only ship the session one, `null` when storage is blocked — a
 * blocked store must close the legend, never crash the screen. */
function legendStorage(): Storage | null {
  try {
    if (typeof window.localStorage !== 'undefined' && window.localStorage !== null) return window.localStorage;
    if (typeof window.sessionStorage !== 'undefined' && window.sessionStorage !== null) return window.sessionStorage;
  } catch {
    return null;
  }
  return null;
}

export function readLegendOpenPreference(): boolean {
  try {
    return legendStorage()?.getItem(LEGEND_OPEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeLegendOpenPreference(open: boolean): void {
  try {
    legendStorage()?.setItem(LEGEND_OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Storage full or blocked: the legend just falls back to its default on the next visit.
  }
}

function Legend(): ReactElement {
  const [open, setOpen] = useState<boolean>(readLegendOpenPreference);
  const chevronClass = [styles.legendChevron, open ? styles.legendChevronOpen : null].filter((entry): entry is string => Boolean(entry)).join(' ');

  function toggle(): void {
    const next = !open;
    setOpen(next);
    writeLegendOpenPreference(next);
  }

  return (
    <section className={styles.legend} aria-labelledby="projects-legend-title">
      <h2 id="projects-legend-title" className={styles.legendTitle}>
        <button type="button" className={styles.legendToggle} aria-expanded={open} aria-controls="projects-legend-body" onClick={toggle}>
          <ChevronDown aria-hidden="true" size={16} className={chevronClass} />
          Cómo leer la tabla
        </button>
      </h2>
      {open ? (
        <div id="projects-legend-body" className={styles.legendBody}>
          <ol className={styles.legendStations} aria-label="Estaciones de la línea, en orden">
            {STATIONS.map((station, index) => (
              <li key={station}>
                {STATION_LABELS[station]}
                {index < STATIONS.length - 1 ? ' ·' : ''}
              </li>
            ))}
          </ol>
          <ul className={styles.legendList}>
            <li>Un segmento con contorno está detenido: la línea se frenó en esa estación.</li>
            <li>Un cuadrado sin relleno marca un proyecto que nadie del equipo ve.</li>
            <li>Drift: las diferencias entre lo que dice el grafo y lo que reporta el código, detectadas por CI.</li>
            <li>Órdenes en curso: las que ya se empezaron y todavía no se cerraron.</li>
            <li>Acceso: las personas del equipo que ven el proyecto.</li>
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function projectRoleOf(role: string): ProjectRole | undefined {
  return PROJECT_ROLES.find((candidate) => candidate === role);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = DAY_MS * 7;

function formatRelativeActivity(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'Sin actividad';
  const diff = now - new Date(iso).getTime();
  if (diff < MINUTE_MS) return 'hace instantes';
  if (diff < HOUR_MS) return `hace ${Math.max(1, Math.round(diff / MINUTE_MS))} min`;
  if (diff < DAY_MS) return `hace ${Math.round(diff / HOUR_MS)} h`;
  if (diff < WEEK_MS) return `hace ${Math.round(diff / DAY_MS)} d`;
  return new Date(iso).toLocaleDateString('es-AR');
}

function matchesFilter(project: ProjectOverviewDto, filter: ProjectFilter): boolean {
  if (filter === 'active') return project.archivedAt === null;
  if (filter === 'archived') return project.archivedAt !== null;
  return true;
}

function matchesLineFilter(project: ProjectOverviewDto, lineFilter: LineFilter): boolean {
  if (lineFilter === 'stopped') return project.andonStation !== null;
  if (lineFilter === 'drift') return project.driftErrors + project.driftWarnings > 0;
  if (lineFilter === 'awaiting') return project.awaitingFirstReport;
  return true;
}

function joinWithY(parts: readonly string[]): string {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

function noMatchMessage(query: string, filter: ProjectFilter, lineFilter: LineFilter): string {
  const active = [
    query.trim() !== '' ? `la búsqueda «${query.trim()}»` : null,
    filter !== 'all' ? `«${PROJECT_FILTER_LABELS[filter]}»` : null,
    lineFilter !== 'all' ? `«${LINE_FILTER_LABELS[lineFilter]}»` : null,
  ].filter((part): part is string => part !== null);
  return active.length === 0 ? 'Ningún proyecto coincide con el filtro.' : `Ningún proyecto coincide con ${joinWithY(active)}.`;
}

interface ColumnActions {
  readonly orgSlug: string;
  readonly orgRole: PermissionSubject['orgRole'];
  readonly onArchive: (project: ProjectOverviewDto) => void;
  readonly onUnarchive: (project: ProjectOverviewDto) => void;
}

function buildColumns({ orgSlug, orgRole, onArchive, onUnarchive }: ColumnActions): readonly DataTableColumn<ProjectOverviewDto>[] {
  return [
    {
      key: 'name',
      header: 'Proyecto',
      sortValue: (project) => project.name,
      rowLink: (project) => `/o/${orgSlug}/p/${project.slug}`,
      render: (project) => (
        <span className={styles.nameCell}>
          <span className={styles.nameRow}>
            <span className={styles.name}>{project.name}</span>
            {project.archivedAt ? <span className={styles.meta}>Archivado</span> : null}
          </span>
          <span className={styles.meta}>
            <span className="id">{project.slug}</span> · <span className="num">{project.docCount} docs</span>
          </span>
        </span>
      ),
    },
    {
      key: 'line',
      header: 'Estado de la línea',
      sortValue: (project) => stationPosition(project.andonStation ?? project.furthestStation),
      render: (project) => <LineStatus project={project} orgSlug={orgSlug} />,
    },
    {
      key: 'drift',
      header: 'Drift',
      sortValue: (project) => project.driftErrors * 100 + project.driftWarnings,
      render: (project) => <DriftCell project={project} orgSlug={orgSlug} />,
    },
    {
      key: 'orders',
      header: 'Órdenes en curso',
      align: 'end',
      sortValue: (project) => project.workOrdersInProgress,
      render: (project) => (
        <Link to={`/o/${orgSlug}/p/${project.slug}/ordenes`} className={`${styles.cellLink} num`}>
          {project.workOrdersInProgress}
        </Link>
      ),
    },
    {
      key: 'acceso',
      header: 'Acceso',
      align: 'end',
      sortValue: (project) => project.memberCount ?? 0,
      render: (project) => (
        <AccessCell project={project} orgSlug={orgSlug} canManageMembers={can({ orgRole, projectRole: projectRoleOf(project.myRole) }, 'manage_members')} />
      ),
    },
    { key: 'role', header: 'Tu rol', render: (project) => projectRoleLabel(project.myRole) },
    {
      key: 'activity',
      header: 'Última actividad',
      align: 'end',
      sortValue: (project) => (project.lastActivityAt ? new Date(project.lastActivityAt).getTime() : undefined),
      render: (project) => <span className="num">{formatRelativeActivity(project.lastActivityAt)}</span>,
    },
    {
      key: 'acciones',
      header: 'Acciones',
      render: (project) => {
        if (!can({ orgRole, projectRole: projectRoleOf(project.myRole) }, 'archive')) return null;
        const archived = project.archivedAt !== null;
        return (
          <span className={styles.rowAction}>
            <Button type="button" variant="ghost" size="sm" onClick={() => (archived ? onUnarchive(project) : onArchive(project))}>
              {archived ? 'Desarchivar' : 'Archivar'}
            </Button>
          </span>
        );
      },
    },
  ];
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface NewProjectModalProps {
  readonly open: boolean;
  readonly orgSlug: string;
  readonly onClose: () => void;
  readonly onCreated: () => void;
}

function NewProjectModal({ open, orgSlug, onClose, onCreated }: NewProjectModalProps): ReactElement {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const mutation = useApiMutation((input: CreateProjectInput) => createProject(orgSlug, input));

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function handleSlugChange(event: ChangeEvent<HTMLInputElement>): void {
    setSlugTouched(true);
    setSlug(event.target.value);
  }

  function resetAndClose(): void {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setValidationError(null);
    onClose();
  }

  async function handleSubmit(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    if (!projectNameSchema.safeParse(name).success) {
      setValidationError('Ingresá un nombre (máx. 100 caracteres).');
      return;
    }
    if (!projectSlugSchema.safeParse(slug).success) {
      setValidationError(`Minúsculas, números y guiones simples (coincide con ${PROJECT_SLUG_PATTERN.source}).`);
      return;
    }
    setValidationError(null);
    try {
      await mutation.mutate({ slug, name });
      resetAndClose();
      onCreated();
    } catch (err) {
      setValidationError(errorMessage(err));
    }
  }

  return (
    <Modal
      open={open}
      title="Nuevo proyecto"
      onClose={resetAndClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={mutation.status === 'cargando'} onClick={() => void handleSubmit()}>
            Crear proyecto
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div>
          <label htmlFor="new-project-name">Nombre</label>
          <input id="new-project-name" value={name} onChange={handleNameChange} />
        </div>
        <div>
          <label htmlFor="new-project-slug">Slug</label>
          <input id="new-project-slug" value={slug} onChange={handleSlugChange} />
        </div>
        {validationError ? <p role="alert">{validationError}</p> : null}
      </form>
    </Modal>
  );
}

interface ArchiveProjectModalProps {
  readonly project: ProjectOverviewDto | null;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function ArchiveProjectModal({ project, submitting, error, onCancel, onConfirm }: ArchiveProjectModalProps): ReactElement {
  return (
    <Modal
      open={project !== null}
      title={`Archivar ${project?.name ?? ''}`}
      description="El proyecto sale de Activos y queda en Archivados. No se borra nada y podés desarchivarlo cuando quieras."
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={submitting} onClick={onConfirm}>
            Archivar
          </Button>
        </>
      }
    >
      {error ? <p role="alert">{error}</p> : null}
    </Modal>
  );
}

function ProjectsDashboardContent(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  const { show } = useToast();
  useDocumentTitle('Proyectos');

  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [lineFilter, setLineFilter] = useState<LineFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState<string>>({ key: 'activity', direction: 'desc' });
  const [modalOpen, setModalOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProjectOverviewDto | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const archiveMutation = useApiMutation((project: ProjectOverviewDto) => archiveProject(orgSlug, project.slug));
  const unarchiveMutation = useApiMutation((project: ProjectOverviewDto) => unarchiveProject(orgSlug, project.slug));

  const projectsQuery = useApiQuery(`projects-overview:${orgSlug}`, () => getProjectsOverview(orgSlug), [orgSlug]);
  const orgRole = currentOrg.role;
  const unarchiveRef = useRef<(project: ProjectOverviewDto) => Promise<void>>(async () => undefined);
  const columns = useMemo(
    () =>
      buildColumns({
        orgSlug,
        orgRole,
        onArchive: (project) => {
          setArchiveError(null);
          setArchiveTarget(project);
        },
        onUnarchive: (project) => void unarchiveRef.current(project),
      }),
    [orgSlug, orgRole],
  );
  const projects = projectsQuery.data ?? [];

  // FB-239 / SDD-101 D5: each group of chips counts over the set the *other* group leaves visible, so a chip
  // never promises N rows the table will not show. The project group counts inside the current line filter;
  // the line group counts inside the current project filter, and its «Todos» is "all rows the project filter
  // leaves", not "all projects in the org".
  const byProjectFilter = projects.filter((project) => matchesFilter(project, filter));
  const byLineFilter = projects.filter((project) => matchesLineFilter(project, lineFilter));
  const activeCount = byLineFilter.filter((project) => project.archivedAt === null).length;
  const archivedCount = byLineFilter.length - activeCount;
  const stoppedCount = byProjectFilter.filter((project) => matchesLineFilter(project, 'stopped')).length;
  const driftCount = byProjectFilter.filter((project) => matchesLineFilter(project, 'drift')).length;
  const awaitingCount = byProjectFilter.filter((project) => matchesLineFilter(project, 'awaiting')).length;
  const lineAllCount = byProjectFilter.length;

  const visible = useMemo(() => {
    const byFilter = filterItems(projects, [(project) => matchesFilter(project, filter), (project) => matchesLineFilter(project, lineFilter)]);
    const searched = searchItems(byFilter, query, (project) => [project.name, project.slug]);
    const column = columns.find((entry) => entry.key === sort.key);
    return sortItems(searched, column?.sortValue ?? (() => undefined), sort.direction);
  }, [projects, filter, lineFilter, query, sort, columns]);

  if (projectsQuery.status === 'cargando') {
    return (
      <div>
        <PageHeader title="Proyectos" />
        <Skeleton rows={5} />
      </div>
    );
  }

  if (projectsQuery.status === 'error') {
    return (
      <div>
        <PageHeader title="Proyectos" />
        <ErrorState title="No pudimos cargar los proyectos" body={errorMessage(projectsQuery.error)} onRetry={projectsQuery.retry} />
      </div>
    );
  }

  const canCreate = isOrgAdmin(currentOrg.role);

  function cancelArchive(): void {
    setArchiveTarget(null);
    setArchiveError(null);
  }

  async function handleUnarchive(project: ProjectOverviewDto): Promise<void> {
    setActionError(null);
    try {
      await unarchiveMutation.mutate(project);
    } catch (err) {
      setActionError(errorMessage(err));
      return;
    }
    projectsQuery.retry();
    show(`${project.name} volvió a Activos`, { tone: 'success' });
  }
  unarchiveRef.current = handleUnarchive;

  async function confirmArchive(): Promise<void> {
    if (!archiveTarget) return;
    try {
      await archiveMutation.mutate(archiveTarget);
    } catch (err) {
      setArchiveError(errorMessage(err));
      return;
    }
    const { name } = archiveTarget;
    cancelArchive();
    projectsQuery.retry();
    show(`${name} quedó archivado`, { tone: 'success' });
  }

  function handleCreated(): void {
    setModalOpen(false);
    projectsQuery.retry();
  }

  return (
    <div>
      <PageHeader
        title="Proyectos"
        subtitle={`${projects.length} ${projects.length === 1 ? 'proyecto' : 'proyectos'} en ${currentOrg.name}`}
        actions={
          <>
            <SearchField label="Buscar proyectos" value={query} onChange={setQuery} placeholder="Buscar proyectos" />
            {canCreate ? (
              <Button type="button" variant="primary" onClick={() => setModalOpen(true)}>
                Nuevo proyecto
              </Button>
            ) : null}
          </>
        }
      />

      {projectsQuery.status === 'vacio' ? (
        <EmptyState
          title="Todavía no hay proyectos"
          body="Creá el primero para esta organización."
          action={canCreate ? { label: 'Nuevo proyecto', onClick: () => setModalOpen(true) } : undefined}
        />
      ) : (
        <>
          <div className={styles.filters}>
            <FilterChips
              label="Filtrar proyectos"
              options={[
                { value: 'active', label: 'Activos', count: activeCount },
                { value: 'archived', label: 'Archivados', count: archivedCount },
                { value: 'all', label: 'Todos' },
              ]}
              value={filter}
              onChange={(value) => setFilter(value as ProjectFilter)}
            />
            <FilterChips
              label="Estado de la línea"
              options={[
                { value: 'all', label: 'Todos', count: lineAllCount },
                { value: 'stopped', label: 'Detenidos', count: stoppedCount },
                { value: 'drift', label: 'Con drift', count: driftCount },
                { value: 'awaiting', label: 'Esperando CI', count: awaitingCount },
              ]}
              value={lineFilter}
              onChange={(value) => setLineFilter(value as LineFilter)}
            />
          </div>
          <Legend />
          {actionError ? (
            <p role="alert" className={styles.actionError}>
              {actionError}
            </p>
          ) : null}
          <DataTable
            caption="Proyectos"
            columns={columns}
            rows={visible}
            getRowId={(project) => project.id}
            sort={sort}
            onSortChange={setSort}
            emptyState={<p>{noMatchMessage(query, filter, lineFilter)}</p>}
          />
          <p className={styles.footnote}>¿No ves un proyecto? Pedile acceso a un admin de {currentOrg.name}.</p>
        </>
      )}

      <ArchiveProjectModal
        project={archiveTarget}
        submitting={archiveMutation.status === 'cargando'}
        error={archiveError}
        onCancel={cancelArchive}
        onConfirm={() => void confirmArchive()}
      />
      {canCreate ? <NewProjectModal open={modalOpen} orgSlug={orgSlug} onClose={() => setModalOpen(false)} onCreated={handleCreated} /> : null}
    </div>
  );
}

export function ProjectsDashboard(): ReactElement {
  return (
    <ToastProvider>
      <ProjectsDashboardContent />
    </ToastProvider>
  );
}
