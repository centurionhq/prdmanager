import { useState, type ReactElement } from 'react';
import type { WorkOrderStatus } from '@prdm/core';
import { listWorkOrders } from '../api/client';
import { useGraphData } from '../hooks/useGraphData';
import { useSelection } from '../state/selection';
import { EmptyState, ErrorState, LoadingState } from './StatusState';
import styles from './WorkOrderList.module.css';

const FILTERS: { label: string; value: WorkOrderStatus | undefined }[] = [
  { label: 'todos', value: undefined },
  { label: 'pending', value: 'pending' },
  { label: 'in_progress', value: 'in_progress' },
  { label: 'out_of_sync', value: 'out_of_sync' },
  { label: 'done', value: 'done' },
];

function statusClass(status: string): string {
  if (status === 'out_of_sync') return `${styles.status} ${styles.statusAttention}`;
  if (status === 'in_progress') return `${styles.status} ${styles.statusActive}`;
  if (status === 'done') return `${styles.status} ${styles.statusDone}`;
  return styles.status ?? '';
}

/**
 * `components/WorkOrderList.tsx` (SDD-005 "Frontend"): read-only — no claim/complete actions, that's CLI/MCP
 * territory. Filtering by status is client-driven per click, refetching `/api/work-orders` with the new query.
 */
export function WorkOrderList(): ReactElement {
  const { select } = useSelection();
  const [status, setStatus] = useState<WorkOrderStatus | undefined>(undefined);
  const { status: loadStatus, data, error, refetch } = useGraphData(() => listWorkOrders({ status }), [status]);

  return (
    <section className={styles.panel} aria-label="Work Orders">
      <div className={styles.head}>
        <p className={styles.eyebrow}>Work Orders</p>
        <div className={styles.filters} role="group" aria-label="Filtrar por estado">
          {FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              className={styles.chip}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      {loadStatus === 'loading' && <LoadingState label="Cargando work orders…" />}
      {loadStatus === 'error' && <ErrorState error={error} onRetry={refetch} />}
      {loadStatus === 'ready' &&
        (data && data.length > 0 ? (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>WO</th>
                  <th>Título</th>
                  <th>Blueprint</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.map((wo) => (
                  <tr
                    key={wo.id}
                    className={styles.row}
                    tabIndex={0}
                    role="button"
                    aria-label={`Ver detalle de ${wo.id}: ${wo.title}`}
                    onClick={() => select(wo.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        select(wo.id);
                      }
                    }}
                  >
                    <td className={styles.idCell}>{wo.id}</td>
                    <td>{wo.title}</td>
                    <td>{wo.blueprints.join(', ')}</td>
                    <td>
                      <span className={statusClass(wo.status)}>{wo.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState label="Sin work orders para este filtro" />
        ))}
    </section>
  );
}
