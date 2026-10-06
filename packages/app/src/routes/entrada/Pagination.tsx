import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactElement } from 'react';
import styles from './Pagination.module.css';

export interface PaginationProps {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly pageSize: number;
  readonly onChange: (page: number) => void;
}

/**
 * Screen-level paginator for the Entrada table (SDD-065 WO-B, D3): a `nav` with the visible range, the
 * current page and prev/next. The range lives in an `aria-live` region so a page change is announced.
 */
export function Pagination({ page, pageCount, total, pageSize, onChange }: PaginationProps): ReactElement | null {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className={styles.pagination} aria-label="Paginación de la bandeja">
      <span className={`${styles.range} num`} aria-live="polite">
        {from}–{to} de {total}
      </span>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        <span className={styles.page}>
          Página {page} de {pageCount}
        </span>
        <button
          type="button"
          className={styles.button}
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount}
          aria-label="Página siguiente"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
    </nav>
  );
}
