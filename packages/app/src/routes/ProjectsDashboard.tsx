/**
 * `/o/:orgSlug` index route (Centurion Factory "Proyectos", SDD-012/SDD-013, WO-353): every project the
 * caller can see in this org, from `getProjectsOverview` — richer than the old `listProjects`-backed
 * grid (line status, drift, orders in progress, role, last activity). See canvas/Proyectos.dc.html; the
 * top bar itself is `OrgShell`'s own header, unchanged by this WO.
 */
import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import {
  PROJECT_SLUG_PATTERN,
  STATIONS,
  projectNameSchema,
  projectSlugSchema,
  type CreateProjectInput,
  type ProjectOverviewDto,
  type Station,
} from '@prdm/contracts';
import { createProject, getProjectsOverview } from '../api/client.js';
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
  type DataTableColumn,
} from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { filterItems, searchItems, sortItems, type SortState } from '../lib/filter-sort.js';
import { useOrgShellContext } from './OrgShell.js';

const STATION_LABELS: Record<Station, string> = {
  ingesta: 'Ingesta',
  definicion: 'Definición',
  diseno: 'Diseño',
  planificacion: 'Planificación',
  ejecucion: 'Ejecución',
  cierre: 'Cierre',
};

type ProjectFilter = 'active' | 'archived' | 'all';

function stationPosition(station: Station): number {
  return STATIONS.indexOf(station) + 1;
}

function lineLabel(project: ProjectOverviewDto): string {
  const reached = `Llega a ${STATION_LABELS[project.furthestStation]}`;
  return project.andonStation ? `${reached}, detenida en ${STATION_LABELS[project.andonStation]}` : reached;
}

function LineStatus({ project }: { readonly project: ProjectOverviewDto }): ReactElement {
  const reached = stationPosition(project.furthestStation);
  const andonAt = project.andonStation ? stationPosition(project.andonStation) : 0;

  return (
    <span>
      <span className="visually-hidden">{lineLabel(project)}</span>
      <span aria-hidden="true" style={{ display: 'inline-flex', gap: 4 }}>
        {STATIONS.map((station, index) => {
          const position = index + 1;
          const background = position === andonAt ? 'var(--andon)' : position <= reached ? 'var(--grafito)' : 'var(--regla)';
          return <span key={station} style={{ display: 'inline-block', width: 20, height: 6, background }} />;
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
  if (project.driftErrors > 0) return `${project.driftErrors} ${project.driftErrors === 1 ? 'error' : 'errores'}`;
  if (project.driftWarnings > 0) return `${project.driftWarnings} ${project.driftWarnings === 1 ? 'aviso' : 'avisos'}`;
  if (project.awaitingFirstReport) return 'Esperando primer reporte de CI';
  return 'Sin drift';
}

const DRIFT_TEXT_COLOR: Record<DriftTone, string> = {
  error: 'var(--paro)',
  warning: 'var(--andon-texto)',
  awaiting: 'var(--apagado)',
  ok: 'var(--senal-texto)',
};

const DRIFT_MARK_COLOR: Record<Exclude<DriftTone, 'awaiting'>, string> = {
  error: 'var(--paro)',
  warning: 'var(--andon)',
  ok: 'var(--senal)',
};

function DriftCell({ project }: { readonly project: ProjectOverviewDto }): ReactElement {
  const tone = driftTone(project);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: DRIFT_TEXT_COLOR[tone], fontWeight: tone === 'awaiting' ? 400 : 600 }}>
      {tone === 'awaiting' ? null : (
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: tone === 'warning' ? 4 : 0, background: DRIFT_MARK_COLOR[tone] }} />
      )}
      {driftLabel(project)}
    </span>
  );
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

function buildColumns(orgSlug: string): readonly DataTableColumn<ProjectOverviewDto>[] {
  return [
    {
      key: 'name',
      header: 'Proyecto',
      sortValue: (project) => project.name,
      rowLink: (project) => `/o/${orgSlug}/p/${project.slug}`,
      render: (project) => (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{project.name}</span>
            {project.archivedAt ? <span style={{ fontSize: 12, color: 'var(--apagado)' }}>Archivado</span> : null}
          </span>
          <span style={{ fontSize: 12, color: 'var(--apagado)' }}>
            <span className="id">{project.slug}</span> · <span className="num">{project.docCount} docs</span>
          </span>
        </span>
      ),
    },
    { key: 'line', header: 'Estado de la línea', render: (project) => <LineStatus project={project} /> },
    { key: 'drift', header: 'Drift', render: (project) => <DriftCell project={project} /> },
    {
      key: 'orders',
      header: 'Órdenes en curso',
      align: 'end',
      sortValue: (project) => project.workOrdersInProgress,
      render: (project) => <span className="num">{project.workOrdersInProgress}</span>,
    },
    { key: 'role', header: 'Tu rol', render: (project) => roleLabel(project.myRole) },
    {
      key: 'activity',
      header: 'Última actividad',
      align: 'end',
      sortValue: (project) => (project.lastActivityAt ? new Date(project.lastActivityAt).getTime() : undefined),
      render: (project) => <span className="num">{formatRelativeActivity(project.lastActivityAt)}</span>,
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

export function ProjectsDashboard(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  useDocumentTitle('Proyectos');

  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState<string>>({ key: 'activity', direction: 'desc' });
  const [modalOpen, setModalOpen] = useState(false);

  const projectsQuery = useApiQuery(`projects-overview:${orgSlug}`, () => getProjectsOverview(orgSlug), [orgSlug]);
  const columns = useMemo(() => buildColumns(orgSlug), [orgSlug]);
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
          <DataTable
            caption="Proyectos"
            columns={columns}
            rows={visible}
            getRowId={(project) => project.id}
            sort={sort}
            onSortChange={setSort}
            emptyState={<p>Ningún proyecto coincide con el filtro.</p>}
          />
          <p style={{ fontSize: 14, color: 'var(--apagado)' }}>¿No ves un proyecto? Pedile acceso a un admin de {currentOrg.name}.</p>
        </>
      )}

      {canCreate ? <NewProjectModal open={modalOpen} orgSlug={orgSlug} onClose={() => setModalOpen(false)} onCreated={handleCreated} /> : null}
    </div>
  );
}
