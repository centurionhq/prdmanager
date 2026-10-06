/**
 * `/o/:orgSlug` index route (Centurion Factory "Proyectos", SDD-012/SDD-013, WO-353): every project the
 * caller can see in this org, from `getProjectsOverview` — richer than the old `listProjects`-backed
 * grid (line status, drift, orders in progress, role, last activity). See canvas/Proyectos.dc.html; the
 * top bar itself is `OrgShell`'s own header, unchanged by this WO.
 */
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router';
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

function stationPosition(station: Station): number {
  return STATIONS.indexOf(station) + 1;
}

function lineLabel(project: ProjectOverviewDto): string {
  const reached = `Llega a ${STATION_LABELS[project.furthestStation]}`;
  return project.andonStation ? `${reached}, detenida en ${STATION_LABELS[project.andonStation]}` : reached;
}

function segmentLabel(station: Station, position: number, reached: number, andonAt: number): string {
  if (position === andonAt) return `Detenida en ${STATION_LABELS[station]}`;
  return `${STATION_LABELS[station]} · ${position <= reached ? 'alcanzada' : 'pendiente'}`;
}

function segmentClass(position: number, reached: number, andonAt: number): string {
  if (position === andonAt) return `${styles.segment} ${styles.segmentStopped}`;
  return position <= reached ? `${styles.segment} ${styles.segmentReached}` : styles.segment!;
}

function LineStatus({ project }: { readonly project: ProjectOverviewDto }): ReactElement {
  const reached = stationPosition(project.furthestStation);
  const andonAt = project.andonStation ? stationPosition(project.andonStation) : 0;

  return (
    <span className={styles.lineCell}>
      <span className={styles.lineText}>{lineLabel(project)}</span>
      <span className={styles.segments}>
        {STATIONS.map((station, index) => {
          const position = index + 1;
          return <span key={station} role="img" aria-label={segmentLabel(station, position, reached, andonAt)} className={segmentClass(position, reached, andonAt)} />;
        })}
      </span>
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

function AccessCell({ project, orgSlug }: { readonly project: ProjectOverviewDto; readonly orgSlug: string }): ReactElement {
  const members = project.memberCount ?? 0;
  const text = members > 0 ? `${members} ${members === 1 ? 'miembro' : 'miembros'}` : 'Sin miembros · nadie del equipo lo ve';
  return (
    <Link to={`/o/${orgSlug}/p/${project.slug}/ajustes/miembros`} className={`${styles.cellLink} num`}>
      {text}
    </Link>
  );
}

function Legend(): ReactElement {
  return (
    <section className={styles.legend} aria-labelledby="projects-legend-title">
      <h2 id="projects-legend-title" className={styles.legendTitle}>
        Cómo leer la tabla
      </h2>
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
        <li>Drift: las diferencias entre lo que dice el grafo y lo que reporta el código, detectadas por CI.</li>
        <li>Órdenes en curso: las que ya se empezaron y todavía no se cerraron.</li>
        <li>Acceso: las personas del equipo que ven el proyecto.</li>
      </ul>
    </section>
  );
}

function projectRoleOf(role: string): ProjectRole | undefined {
  return PROJECT_ROLES.find((candidate) => candidate === role);
}

function roleLabel(role: string): string {
  return role.length === 0 ? role : role.charAt(0).toUpperCase() + role.slice(1);
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
    { key: 'line', header: 'Estado de la línea', render: (project) => <LineStatus project={project} /> },
    { key: 'drift', header: 'Drift', render: (project) => <DriftCell project={project} orgSlug={orgSlug} /> },
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
      render: (project) => <AccessCell project={project} orgSlug={orgSlug} />,
    },
    { key: 'role', header: 'Tu rol', render: (project) => roleLabel(project.myRole) },
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

  const activeCount = projects.filter((project) => project.archivedAt === null).length;
  const archivedCount = projects.length - activeCount;

  const visible = useMemo(() => {
    const byFilter = filterItems(projects, [(project) => matchesFilter(project, filter)]);
    const searched = searchItems(byFilter, query, (project) => [project.name, project.slug]);
    const column = columns.find((entry) => entry.key === sort.key);
    return sortItems(searched, column?.sortValue ?? (() => undefined), sort.direction);
  }, [projects, filter, query, sort, columns]);

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
            emptyState={<p>Ningún proyecto coincide con el filtro.</p>}
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
