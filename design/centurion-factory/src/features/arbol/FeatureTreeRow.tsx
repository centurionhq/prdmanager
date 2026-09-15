/** One row of the FeatureTree ARIA tree: guides, chevron, id/title and the drift dot. */
import { ChevronRight } from 'lucide-react';
import type { ReactElement } from 'react';
import { driftIssuesForFeature } from '../../data';
import styles from './FeatureTree.module.css';
import type { VisibleRow } from './tree';

function hasErrorDrift(featureId: string): boolean {
  return driftIssuesForFeature(featureId).some((issue) => issue.severity === 'error');
}

function rowClassName(row: VisibleRow, isSelected: boolean): string {
  return [styles.row, isSelected ? styles.selected : null, row.feature.status === 'closed' && !isSelected ? styles.closed : null]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

export interface FeatureTreeRowProps {
  readonly row: VisibleRow;
  readonly isSelected: boolean;
  readonly isFocused: boolean;
  readonly isExpanded: boolean | undefined;
  readonly onSelect: (id: string) => void;
  readonly onFocus: (id: string) => void;
}

export function FeatureTreeRow({ row, isSelected, isFocused, isExpanded, onSelect, onFocus }: FeatureTreeRowProps): ReactElement {
  return (
    <div
      data-id={row.feature.id}
      role="treeitem"
      tabIndex={isFocused ? 0 : -1}
      aria-selected={isSelected}
      aria-expanded={isExpanded}
      aria-level={row.depth + 1}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      className={rowClassName(row, isSelected)}
      onClick={() => onSelect(row.feature.id)}
      onFocus={() => onFocus(row.feature.id)}
    >
      {Array.from({ length: row.depth }, (_, index) => (
        <span key={index} className={styles.guide} aria-hidden="true" />
      ))}
      <span className={styles.toggle} aria-hidden="true">
        {row.hasChildren ? <ChevronRight size={16} strokeWidth={2} className={isExpanded ? styles.chevronOpen : styles.chevronClosed} /> : null}
      </span>
      <span className={['id', styles.id].join(' ')}>{row.feature.id}</span>
      <span className={styles.title}>{row.feature.title}</span>
      {hasErrorDrift(row.feature.id) ? <span className={styles.drift} title="Drift activo" aria-hidden="true" /> : null}
    </div>
  );
}
