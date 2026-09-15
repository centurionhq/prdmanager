/** Column definitions for the Proyectos DataTable. */
import type { DataTableColumn } from '../../components';
import { IdTag } from '../../components';
import type { ProjectSummary } from '../../data';
import { DriftCell } from './DriftCell';
import { LineStatus } from './LineStatus';
import { formatRelativeActivity, roleLabel } from './lib';
import styles from './ProyectosPage.module.css';

export type SortAccessor = (project: ProjectSummary) => string | number | undefined;

export const SORT_ACCESSORS = {
  name: (project) => project.name,
  orders: (project) => project.workOrdersInProgress,
  activity: (project) => new Date(project.lastActivity).getTime(),
} satisfies Record<string, SortAccessor>;

export function getSortAccessor(key: string): SortAccessor {
  if (key === 'name') return SORT_ACCESSORS.name;
  if (key === 'orders') return SORT_ACCESSORS.orders;
  return SORT_ACCESSORS.activity;
}

function ProjectNameCell({ project }: { readonly project: ProjectSummary }) {
  return (
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
  );
}

export function buildProyectosColumns(): readonly DataTableColumn<ProjectSummary>[] {
  return [
    { key: 'name', header: 'Proyecto', sortValue: SORT_ACCESSORS.name, render: (project) => <ProjectNameCell project={project} /> },
    { key: 'line', header: 'Estado de la línea', render: (project) => <LineStatus project={project} /> },
    { key: 'drift', header: 'Drift', render: (project) => <DriftCell project={project} /> },
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
    { key: 'role', header: 'Tu rol', render: (project) => roleLabel(project.role) },
    {
      key: 'activity',
      header: 'Última actividad',
      align: 'end',
      sortValue: SORT_ACCESSORS.activity,
      render: (project) => <span className="num">{formatRelativeActivity(project.lastActivity)}</span>,
    },
  ];
}
