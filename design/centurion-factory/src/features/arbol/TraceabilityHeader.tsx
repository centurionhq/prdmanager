/** TraceabilityPanel's header: id/status, title, meta line and the "Ver cierre" action. */
import type { ReactElement } from 'react';
import { Button, StatusBadge } from '../../components';
import type { Feature } from '../../data';
import styles from './TraceabilityPanel.module.css';
import { formatDateEs } from './traceability';

function metaLine(feature: Feature): string | undefined {
  const parentPart = feature.evolvesFrom ? `Hija de ${feature.evolvesFrom}` : undefined;
  const closedPart = feature.closedAt ? `Cerrada el ${formatDateEs(feature.closedAt)}` : undefined;
  return [parentPart, closedPart].filter((part): part is string => Boolean(part)).join(' · ') || undefined;
}

export interface TraceabilityHeaderProps {
  readonly feature: Feature;
  readonly onOpenClosure?: () => void;
}

export function TraceabilityHeader({ feature, onOpenClosure }: TraceabilityHeaderProps): ReactElement {
  const meta = metaLine(feature);

  return (
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
  );
}
