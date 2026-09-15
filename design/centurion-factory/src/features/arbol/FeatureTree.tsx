import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { driftIssuesForFeature, type Feature } from '../../data';
import styles from './FeatureTree.module.css';
import { applyKeyboardMove, buildTree, expandableIds, flattenVisible, type VisibleRow } from './tree';

export interface FeatureTreeProps {
  readonly features: readonly Feature[];
  readonly selectedId: string;
}

const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

function hasErrorDrift(featureId: string): boolean {
  return driftIssuesForFeature(featureId).some((issue) => issue.severity === 'error');
}

function rowClassName(row: VisibleRow, isSelected: boolean): string {
  return [styles.row, isSelected ? styles.selected : null, row.feature.status === 'closed' && !isSelected ? styles.closed : null]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

/**
 * Keyboard-accessible ARIA tree of the feature hierarchy (WO-283). Arrow keys move a roving
 * tabindex and expand/collapse branches; Enter/Space commit the selection and navigate to
 * `/arbol/<id>`. See canvas/Arbol.dc.html for the guides, chevrons and andon dot.
 */
export function FeatureTree({ features, selectedId }: FeatureTreeProps): ReactElement {
  const navigate = useNavigate();
  const allExpandable = useMemo(() => expandableIds(features), [features]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(allExpandable));
  const [focusedId, setFocusedId] = useState(selectedId);
  const treeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFocusedId((current) => (features.some((feature) => feature.id === current) ? current : selectedId));
  }, [selectedId, features]);

  const tree = useMemo(() => buildTree(features), [features]);
  const rows = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);
  const closedCount = features.filter((feature) => feature.status === 'closed').length;
  const allCollapsed = allExpandable.every((id) => !expanded.has(id));

  function focusRow(id: string): void {
    setFocusedId(id);
    requestAnimationFrame(() => {
      treeRef.current?.querySelector<HTMLDivElement>(`[data-id="${CSS.escape(id)}"]`)?.focus();
    });
  }

  function selectAndNavigate(id: string): void {
    setFocusedId(id);
    navigate(`/arbol/${id}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectAndNavigate(focusedId);
      return;
    }

    if (!MOVE_KEYS.has(event.key)) return;
    event.preventDefault();
    const result = applyKeyboardMove({ key: event.key, focusedId, features, expanded });
    if (!result) return;
    if (result.nextExpanded) setExpanded(result.nextExpanded);
    if (result.nextFocusedId !== focusedId) focusRow(result.nextFocusedId);
  }

  function toggleAll(): void {
    setExpanded(allCollapsed ? new Set(allExpandable) : new Set());
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.summary}>
        <span>
          <span className="num">{features.length}</span> features, <span className="num">{closedCount}</span> cerradas
        </span>
        <button type="button" className={styles.toggleAll} onClick={toggleAll}>
          {allCollapsed ? 'Expandir todo' : 'Contraer todo'}
        </button>
      </div>

      <div ref={treeRef} role="tree" aria-label="Árbol de features" className={styles.tree} onKeyDown={handleKeyDown}>
        {rows.map((row) => {
          const isSelected = row.feature.id === selectedId;
          const isFocused = row.feature.id === focusedId;
          const isExpanded = row.hasChildren ? expanded.has(row.feature.id) : undefined;
          return (
            <div
              key={row.feature.id}
              data-id={row.feature.id}
              role="treeitem"
              tabIndex={isFocused ? 0 : -1}
              aria-selected={isSelected}
              aria-expanded={isExpanded}
              aria-level={row.depth + 1}
              aria-setsize={row.setSize}
              aria-posinset={row.posInSet}
              className={rowClassName(row, isSelected)}
              onClick={() => selectAndNavigate(row.feature.id)}
              onFocus={() => setFocusedId(row.feature.id)}
            >
              {Array.from({ length: row.depth }, (_, index) => (
                <span key={index} className={styles.guide} aria-hidden="true" />
              ))}
              <span className={styles.toggle} aria-hidden="true">
                {row.hasChildren ? (
                  <ChevronRight size={16} strokeWidth={2} className={isExpanded ? styles.chevronOpen : styles.chevronClosed} />
                ) : null}
              </span>
              <span className={['id', styles.id].join(' ')}>{row.feature.id}</span>
              <span className={styles.title}>{row.feature.title}</span>
              {hasErrorDrift(row.feature.id) ? <span className={styles.drift} title="Drift activo" aria-hidden="true" /> : null}
            </div>
          );
        })}
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
