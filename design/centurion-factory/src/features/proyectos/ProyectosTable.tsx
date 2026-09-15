/** ProyectosPage's filter chips, DataTable and footer note, shown once data has loaded. */
import type { ReactElement } from 'react';
import { DataTable, FilterChips } from '../../components';
import styles from './ProyectosPage.module.css';
import { buildProyectosColumns } from './proyectosColumns';
import type { ProjectFilter, UseProyectosStateResult } from './useProyectosState';

const COLUMNS = buildProyectosColumns();

export interface ProyectosTableProps {
  readonly state: UseProyectosStateResult;
}

export function ProyectosTable({ state }: ProyectosTableProps): ReactElement {
  const filterOptions = [
    { value: 'active', label: 'Activos', count: state.activeCount },
    { value: 'archived', label: 'Archivados', count: state.archivedCount },
    { value: 'all', label: 'Todos' },
  ];

  return (
    <>
      <FilterChips
        label="Filtrar proyectos"
        options={filterOptions}
        value={state.filter}
        onChange={(value) => state.setFilter(value as ProjectFilter)}
      />
      <DataTable
        caption="Proyectos de Centurion HQ"
        columns={COLUMNS}
        rows={state.visibleProjects}
        getRowId={(project) => project.slug}
        sort={state.sort}
        onSortChange={state.setSort}
        onRowClick={state.handleRowClick}
      />
      <p className={styles.footerNote}>¿No ves un proyecto? Pedile acceso a un admin de Centurion HQ.</p>
    </>
  );
}
