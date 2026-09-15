import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Button, DataTable, IdTag, StatusBadge, type DataTableColumn } from '../../components';
import type { Feature, WorkOrder } from '../../data';
import styles from './TraceabilityPanel.module.css';
import { formatDateEs, recentOrdersForBlueprint, traceabilityFor } from './traceability';

export interface TraceabilityPanelProps {
  readonly feature: Feature;
  readonly onOpenClosure?: () => void;
}

function metaLine(feature: Feature): string | undefined {
  const parentPart = feature.evolvesFrom ? `Hija de ${feature.evolvesFrom}` : undefined;
  const closedPart = feature.closedAt ? `Cerrada el ${formatDateEs(feature.closedAt)}` : undefined;
  return [parentPart, closedPart].filter((part): part is string => Boolean(part)).join(' · ') || undefined;
}

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

/** The right-hand detail panel of the Árbol de features screen (WO-284): header, trazabilidad
 * chain and the recent work order history of the feature's primary blueprint. */
export function TraceabilityPanel({ feature, onOpenClosure }: TraceabilityPanelProps): ReactElement {
  const chain = traceabilityFor(feature);
  const meta = metaLine(feature);
  const recentOrders = chain.primaryBlueprintId ? recentOrdersForBlueprint(chain.primaryBlueprintId) : [];

  return (
    <div className={styles.panel}>
      <div className={styles.headerRow}>
        <div className={styles.headerText}>
          <div className={styles.idRow}>
            <span className="id">{feature.id}</span>
            <StatusBadge kind="feature" status={feature.status} />
          </div>
          <h2 className={styles.title}>{feature.title}</h2>
          {meta ? <div className={styles.meta}>{meta}</div> : null}
        </div>
        <Button type="button" variant="secondary" onClick={onOpenClosure}>
          Ver cierre de feature
        </Button>
      </div>

      <div className={styles.chainSection}>
        <h3 className={styles.sectionTitle}>Trazabilidad</h3>
        <div className={styles.chain}>
          <div className={styles.chainColumn}>
            <span className={styles.chainDot} aria-hidden="true" />
            <span className={styles.chainLabel}>Origen</span>
            {chain.origin.length > 0 ? (
              chain.origin.map((id) => <span key={id} className="id">{id}</span>)
            ) : (
              <span className={styles.chainMuted}>Sin origen registrado</span>
            )}
          </div>
          <div className={styles.chainColumn}>
            <span className={styles.chainDot} aria-hidden="true" />
            <span className={styles.chainLabel}>Feature</span>
            <span className="id">{feature.id}</span>
          </div>
          <div className={styles.chainColumn}>
            <span className={styles.chainDot} aria-hidden="true" />
            <span className={styles.chainLabel}>Blueprints</span>
            {chain.blueprintIds.length > 0 ? (
              <span className={styles.blueprintLinks}>
                {chain.blueprintIds.map((id) => (
                  <Link key={id} to={`/documentos/${id}`} className="id">
                    {id}
                  </Link>
                ))}
              </span>
            ) : (
              <span className={styles.chainMuted}>Sin blueprints</span>
            )}
          </div>
          <div className={styles.chainColumn}>
            <span className={styles.chainDot} aria-hidden="true" />
            <span className={styles.chainLabel}>Órdenes</span>
            <Link to={`/ordenes?feature=${feature.id}`} className={styles.chainNumber}>
              {chain.ordersLabel}
            </Link>
          </div>
          <div className={styles.chainColumn}>
            <span className={styles.chainDot} aria-hidden="true" />
            <span className={styles.chainLabel}>Commits</span>
            <span className={styles.chainNumber}>{chain.commitsLabel}</span>
          </div>
          <div className={styles.chainColumn}>
            <span className={[styles.chainDot, chain.codeInSync ? styles.chainDotSenal : styles.chainDotParo].join(' ')} aria-hidden="true" />
            <span className={styles.chainLabel}>Código</span>
            <span className={[styles.chainNumber, chain.codeInSync ? styles.codeSynced : styles.codeOutOfSync].join(' ')}>{chain.codeLabel}</span>
          </div>
        </div>
      </div>

      {chain.primaryBlueprintId ? (
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
      ) : null}
    </div>
  );
}
