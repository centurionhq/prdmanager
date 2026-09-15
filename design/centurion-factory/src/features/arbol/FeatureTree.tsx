import type { ReactElement } from 'react';
import type { Feature } from '../../data';
import { FeatureTreeRow } from './FeatureTreeRow';
import styles from './FeatureTree.module.css';
import { useFeatureTreeState } from './useFeatureTreeState';

export interface FeatureTreeProps {
  readonly features: readonly Feature[];
  readonly selectedId: string;
}

/**
 * Keyboard-accessible ARIA tree of the feature hierarchy (WO-283). Arrow keys move a roving
 * tabindex and expand/collapse branches; Enter/Space commit the selection and navigate to
 * `/arbol/<id>`. See canvas/Arbol.dc.html for the guides, chevrons and andon dot.
 */
export function FeatureTree({ features, selectedId }: FeatureTreeProps): ReactElement {
  const tree = useFeatureTreeState(features, selectedId);

  return (
    <div className={styles.wrapper}>
      <div className={styles.summary}>
        <span>
          <span className="num">{features.length}</span> features, <span className="num">{tree.closedCount}</span> cerradas
        </span>
        <button type="button" className={styles.toggleAll} onClick={tree.toggleAll}>
          {tree.allCollapsed ? 'Expandir todo' : 'Contraer todo'}
        </button>
      </div>

      <div ref={tree.treeRef} role="tree" aria-label="Árbol de features" className={styles.tree} onKeyDown={tree.handleKeyDown}>
        {tree.rows.map((row) => (
          <FeatureTreeRow
            key={row.feature.id}
            row={row}
            isSelected={row.feature.id === selectedId}
            isFocused={row.feature.id === tree.focusedId}
            isExpanded={row.hasChildren ? tree.expanded.has(row.feature.id) : undefined}
            onSelect={tree.selectAndNavigate}
            onFocus={tree.setFocusedId}
          />
        ))}
      </div>

      <div className={styles.legend}>
        <span>Las features cerradas se muestran atenuadas.</span>
        <span className={styles.legendItem}>
          <span className={styles.drift} aria-hidden="true" />
          Tiene drift abierto
        </span>
      </div>
    </div>
  );
}
