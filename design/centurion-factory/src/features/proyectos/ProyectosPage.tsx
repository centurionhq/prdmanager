import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { Button, DataTable, EmptyState, ErrorState, FilterChips, IdTag, PageHeader, SearchField, Skeleton, useToast } from '../../components';
import type { DataTableColumn } from '../../components';
import { PROJECTS, type ProjectSummary } from '../../data';
import { filterItems, searchItems, sortItems, type SortState } from '../../lib/filter-sort';
import { useDemoState } from '../../lib/use-demo-state';
import { DriftCell } from './DriftCell';
import { LineStatus } from './LineStatus';
import { NewProjectModal, type NewProjectInput } from './NewProjectModal';
import styles from './ProyectosPage.module.css';
import { formatRelativeActivity, roleLabel } from './lib';
import { TopBar } from './TopBar';

type ProjectFilter = 'active' | 'archived' | 'all';

type SortAccessor = (project: ProjectSummary) => string | number | undefined;

const SORT_ACCESSORS = {
  name: (project) => project.name,
  orders: (project) => project.workOrdersInProgress,
  activity: (project) => new Date(project.lastActivity).getTime(),
} satisfies Record<string, SortAccessor>;

function getSortAccessor(key: string): SortAccessor {
  if (key === 'name') return SORT_ACCESSORS.name;
  if (key === 'orders') return SORT_ACCESSORS.orders;
  return SORT_ACCESSORS.activity;
}

function matchesFilter(project: ProjectSummary, filter: ProjectFilter): boolean {
  if (filter === 'active') return !project.archived;
  if (filter === 'archived') return project.archived;
  return true;
}

function buildColumns(): readonly DataTableColumn<ProjectSummary>[] {
  return [
    {
      key: 'name',
      header: 'Proyecto',
      sortValue: SORT_ACCESSORS.name,
      render: (project) => (
        <div className={styles.projectCell}>
          <div className={styles.projectNameRow}>
            <span className={styles.projectName}>{project.name}</span>
            {project.archived ? <span className={styles.archivedBadge}>Archivado</span> : null}
          </div>
          <div className={styles.projectMeta}>
            <IdTag id={`centurion-hq/${project.slug}`} tone="muted" />
            <span aria-hidden="true">·</span>
            <span className="num">{project.documentCount} docs</span>
          </div>
        </div>
      ),
    },
    {
      key: 'line',
      header: 'Estado de la línea',
      render: (project) => <LineStatus project={project} />,
    },
    {
      key: 'drift',
      header: 'Drift',
      render: (project) => <DriftCell project={project} />,
    },
    {
      key: 'orders',
      header: 'Órdenes en curso',
      align: 'end',
      sortValue: SORT_ACCESSORS.orders,
      render: (project) => (
        <span className={`num ${project.workOrdersInProgress === 0 ? styles.ordersMuted : styles.ordersActive}`}>
          {project.workOrdersInProgress}
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Tu rol',
      render: (project) => roleLabel(project.role),
    },
    {
      key: 'activity',
      header: 'Última actividad',
      align: 'end',
      sortValue: SORT_ACCESSORS.activity,
      render: (project) => <span className="num">{formatRelativeActivity(project.lastActivity)}</span>,
    },
  ];
}

const COLUMNS = buildColumns();

/** /proyectos, outside the project shell. See canvas/Proyectos.dc.html (WO-303). */
export function ProyectosPage(): ReactElement {
  const { state, retry } = useDemoState();
  const navigate = useNavigate();
  const toast = useToast();

  const [projects, setProjects] = useState<readonly ProjectSummary[]>(() => [...PROJECTS]);
  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState<string>>({ key: 'activity', direction: 'desc' });
  const [modalOpen, setModalOpen] = useState(false);

  const activeCount = useMemo(() => projects.filter((project) => !project.archived).length, [projects]);
  const archivedCount = projects.length - activeCount;

  const visibleProjects = useMemo(() => {
    const byFilter = filterItems(projects, [(project) => matchesFilter(project, filter)]);
    const searched = searchItems(byFilter, query, (project) => [project.name, project.slug]);
    return sortItems(searched, getSortAccessor(sort.key), sort.direction);
  }, [projects, filter, query, sort]);

  function handleRowClick(project: ProjectSummary): void {
    if (project.slug === 'prdmanager') {
      navigate('/');
      return;
    }
    toast.show('Este diseño solo tiene datos de prdmanager');
  }

  function handleCreateProject(input: NewProjectInput): void {
    const created: ProjectSummary = {
      slug: input.slug,
      name: input.name,
      documentCount: 0,
      archived: false,
      furthestStation: 'ingesta',
      driftErrors: 0,
      driftWarnings: 0,
      awaitingFirstReport: true,
      workOrdersInProgress: 0,
      role: 'admin',
      lastActivity: new Date().toISOString(),
    };
    setProjects((current) => [created, ...current]);
    setModalOpen(false);
    toast.show('Proyecto creado', { tone: 'success' });
  }

  const filterOptions = [
    { value: 'active', label: 'Activos', count: activeCount },
    { value: 'archived', label: 'Archivados', count: archivedCount },
    { value: 'all', label: 'Todos' },
  ];

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#contenido-proyectos">
        Saltar al contenido
      </a>
      <TopBar />
      <main id="contenido-proyectos" tabIndex={-1} className={styles.main}>
        <PageHeader
          title="Proyectos"
          subtitle={`${projects.length} ${projects.length === 1 ? 'proyecto' : 'proyectos'} en Centurion HQ`}
          actions={
            state === 'listo' ? (
              <>
                <div className={styles.searchWrap}>
                  <SearchField label="Buscar proyectos" value={query} onChange={setQuery} placeholder="Buscar proyectos" />
                </div>
                <Button type="button" variant="primary" onClick={() => setModalOpen(true)}>
                  Nuevo proyecto
                </Button>
              </>
            ) : null
          }
        />

        {state === 'cargando' ? <Skeleton rows={5} /> : null}

        {state === 'error' ? (
          <ErrorState
            title="No pudimos cargar los proyectos"
            body="Volvé a intentarlo en un momento."
            onRetry={retry}
          />
        ) : null}

        {state === 'vacio' ? (
          <EmptyState
            title="Todavía no hay proyectos"
            body="Creá el primero para tu organización."
            action={{ label: 'Nuevo proyecto', onClick: () => setModalOpen(true) }}
          />
        ) : null}

        {state === 'listo' ? (
          <>
            <FilterChips label="Filtrar proyectos" options={filterOptions} value={filter} onChange={(value) => setFilter(value as ProjectFilter)} />
            <DataTable
              caption="Proyectos de Centurion HQ"
              columns={COLUMNS}
              rows={visibleProjects}
              getRowId={(project) => project.slug}
              sort={sort}
              onSortChange={setSort}
              onRowClick={handleRowClick}
            />
            <p className={styles.footerNote}>¿No ves un proyecto? Pedile acceso a un admin de Centurion HQ.</p>
          </>
        ) : null}
      </main>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={handleCreateProject} />
    </div>
  );
}
