/** Project list state, filters and mutations for ProyectosPage (WO-303). */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../components';
import { PROJECTS, type ProjectSummary } from '../../data';
import { filterItems, searchItems, sortItems, type SortState } from '../../lib/filter-sort';
import type { NewProjectInput } from './NewProjectModal';
import { getSortAccessor } from './proyectosColumns';

export type ProjectFilter = 'active' | 'archived' | 'all';

function matchesFilter(project: ProjectSummary, filter: ProjectFilter): boolean {
  if (filter === 'active') return !project.archived;
  if (filter === 'archived') return project.archived;
  return true;
}

export interface UseProyectosStateResult {
  readonly projects: readonly ProjectSummary[];
  readonly filter: ProjectFilter;
  readonly setFilter: (filter: ProjectFilter) => void;
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly sort: SortState<string>;
  readonly setSort: (sort: SortState<string>) => void;
  readonly modalOpen: boolean;
  readonly openModal: () => void;
  readonly closeModal: () => void;
  readonly activeCount: number;
  readonly archivedCount: number;
  readonly visibleProjects: readonly ProjectSummary[];
  readonly handleRowClick: (project: ProjectSummary) => void;
  readonly handleCreateProject: (input: NewProjectInput) => void;
}

export function useProyectosState(): UseProyectosStateResult {
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

  return {
    projects,
    filter,
    setFilter,
    query,
    setQuery,
    sort,
    setSort,
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    activeCount,
    archivedCount,
    visibleProjects,
    handleRowClick,
    handleCreateProject,
  };
}
