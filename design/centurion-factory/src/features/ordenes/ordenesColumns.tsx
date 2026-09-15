/** Column definitions for the Órdenes de trabajo DataTable. */
import { IdTag, StatusBadge, type DataTableColumn } from '../../components';
import type { WorkOrder } from '../../data';
import { formatDateEs } from './format';
import styles from './OrdenesPage.module.css';

export function ordenesColumns(): readonly DataTableColumn<WorkOrder>[] {
  return [
    { key: 'id', header: 'Orden', render: (order) => <IdTag id={order.id} />, sortValue: (order) => order.id, width: '96px' },
    { key: 'title', header: 'Título', render: (order) => order.title },
    { key: 'blueprintId', header: 'Blueprint', render: (order) => <IdTag id={order.blueprintId} />, sortValue: (order) => order.blueprintId, width: '112px' },
    {
      key: 'status',
      header: 'Estado',
      render: (order) => <StatusBadge kind="workOrder" status={order.status} />,
      sortValue: (order) => order.status,
      width: '160px',
    },
    {
      key: 'assignedTo',
      header: 'Asignada a',
      render: (order) =>
        order.assignedTo ? <span className="id">{order.assignedTo}</span> : <span className={styles.unassigned}>Sin asignar</span>,
      sortValue: (order) => order.assignedTo ?? '',
      width: '140px',
    },
    {
      key: 'updatedAt',
      header: 'Actualizada',
      render: (order) => <span className="num">{formatDateEs(order.updatedAt)}</span>,
      sortValue: (order) => order.updatedAt,
      align: 'end',
      width: '112px',
    },
  ];
}
