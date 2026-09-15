/** OrderDrawer's "Criterios de aceptación" section. */
import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import type { WorkOrder } from '../../data';
import styles from './OrderDrawer.module.css';

export interface OrderCriteriaSectionProps {
  readonly criteria: WorkOrder['criteria'];
}

export function OrderCriteriaSection({ criteria }: OrderCriteriaSectionProps): ReactElement {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Criterios de aceptación</h3>
      <ul className={styles.criteria}>
        {criteria.map((criterion) => (
          <li key={criterion.text} className={styles.criterion}>
            <span className={[styles.criterionMark, criterion.done ? styles.criterionDone : null].filter(Boolean).join(' ')} aria-hidden="true">
              {criterion.done ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span>{criterion.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
