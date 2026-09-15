import type { ReactElement } from 'react';
import type { Feature } from '../../data';
import { RecentOrdersSection } from './RecentOrdersSection';
import { TraceabilityChain } from './TraceabilityChain';
import { TraceabilityHeader } from './TraceabilityHeader';
import styles from './TraceabilityPanel.module.css';
import { traceabilityFor } from './traceability';

export interface TraceabilityPanelProps {
  readonly feature: Feature;
  readonly onOpenClosure?: () => void;
}

/** The right-hand detail panel of the Árbol de features screen (WO-284): header, trazabilidad
 * chain and the recent work order history of the feature's primary blueprint. */
export function TraceabilityPanel({ feature, onOpenClosure }: TraceabilityPanelProps): ReactElement {
  const chain = traceabilityFor(feature);

  return (
    <div className={styles.panel}>
      <TraceabilityHeader feature={feature} onOpenClosure={onOpenClosure} />
      <TraceabilityChain feature={feature} chain={chain} />
      <RecentOrdersSection chain={chain} />
    </div>
  );
}
