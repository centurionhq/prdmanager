/** TraceabilityPanel's "Órdenes recientes de <blueprint>" table. */
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { DataTable, IdTag, StatusBadge, type DataTableColumn } from '../../components';
import type { WorkOrder } from '../../data';
import styles from './TraceabilityPanel.module.css';
import { formatDateEs, recentOrdersForBlueprint, type TraceabilityChain } from './traceability';

function recentOrdersColumns(): readonly DataTableColumn<WorkOrder>[] {
  return [
    { key: 'id', header: 'Orden', render: (wo) => <IdTag id={wo.id} />, width: '96px' },
    { key: 'title', header: 'Título', render: (wo) => wo.title },
    { key: 'status', header: 'Estado', render: (wo) => <StatusBadge kind="workOrder" status={wo.status} />, width: '160px' },
    { key: 'commit', header: 'Commit', render: (wo) => (wo.commitShas[0] ? <IdTag id={wo.commitShas[0]} /> : null), width: '96px' },
    {
      key: 'updated',
      header: 'Actualizada',
      render: (wo) => <span className="num">{formatDateEs(wo.completedAt ?? wo.updatedAt)}</span>,
      align: 'end',
      width: '112px',
    },
  ];
}

export interface RecentOrdersSectionProps {
  readonly chain: TraceabilityChain;
}

export function RecentOrdersSection({ chain }: RecentOrdersSectionProps): ReactElement | null {
  if (!chain.primaryBlueprintId) return null;
  const recentOrders = recentOrdersForBlueprint(chain.primaryBlueprintId);

  return (
    <div className={styles.recentSection}>
      <div className={styles.recentHeader}>
        <h3 className={styles.sectionTitle}>
          Órdenes recientes de <span className="id">{chain.primaryBlueprintId}</span>
        </h3>
        <Link to={`/ordenes?blueprint=${chain.primaryBlueprintId}`}>Ver las {chain.ordersDone} órdenes</Link>
      </div>
      <DataTable
        caption={`Órdenes recientes de ${chain.primaryBlueprintId}`}
        columns={recentOrdersColumns()}
        rows={recentOrders}
        getRowId={(wo) => wo.id}
        emptyState={<span>Todavía no hay órdenes registradas para este blueprint.</span>}
      />
    </div>
  );
}
