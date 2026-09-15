import type { ReactElement } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  readonly rows?: number;
  readonly columns?: number;
}

const DEFAULT_ROWS = 3;

// Widths cycle so consecutive rows never look identical, matching the "Skeleton" plate.
const ROW_WIDTHS_PERCENT = [88, 64, 76, 92, 58, 82];

function range(length: number): readonly number[] {
  return Array.from({ length }, (_, index) => index);
}

/** Loading placeholder: an `aria-busy` container plus a visually hidden "Cargando…" label. */
export function Skeleton({ rows = DEFAULT_ROWS, columns }: SkeletonProps): ReactElement {
  return (
    <div className={styles.skeleton} aria-busy="true">
      <span className="visually-hidden">Cargando…</span>
      {range(rows).map((rowIndex) => (
        <div key={rowIndex} className={styles.row} data-skeleton-row="">
          {columns
            ? range(columns).map((columnIndex) => <span key={columnIndex} className={styles.bar} data-skeleton-bar="" />)
            : (
                <span
                  className={styles.bar}
                  data-skeleton-bar=""
                  style={{ width: `${ROW_WIDTHS_PERCENT[rowIndex % ROW_WIDTHS_PERCENT.length] ?? 75}%` }}
                />
              )}
        </div>
      ))}
    </div>
  );
}
