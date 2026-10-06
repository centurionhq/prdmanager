/**
 * The Árbol de features' left-hand ARIA tree (WO-461, SDD-029; approved canvas:
 * `design/centurion-factory/canvas/Arbol.dc.html`), extracted out of `ProjectGraph.tsx` as its own
 * design-system component now that it's the screen's only real reusable piece -- same pattern `LineBoard`
 * set in SDD-024. Keyboard navigation (arrows, Home/End, expand/collapse) is unchanged from the original
 * inline implementation; only the markup moved, from inline styles to this module's CSS classes.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import type { TreeNode } from '@prdm/core';
import styles from './FeatureTree.module.css';

const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

interface VisibleRow {
  readonly node: TreeNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly setSize: number;
  readonly posInSet: number;
}

function flattenVisible(nodes: readonly TreeNode[], expanded: ReadonlySet<string>, depth = 0): readonly VisibleRow[] {
  return nodes.flatMap((node, index) => {
    const row: VisibleRow = { node, depth, hasChildren: node.children.length > 0, setSize: nodes.length, posInSet: index + 1 };
    const isExpanded = node.children.length === 0 || expanded.has(node.ref);
    return isExpanded ? [row, ...flattenVisible(node.children, expanded, depth + 1)] : [row];
  });
}

function collectExpandableRefs(nodes: readonly TreeNode[]): readonly string[] {
  return nodes.flatMap((node) => (node.children.length > 0 ? [node.ref, ...collectExpandableRefs(node.children)] : []));
}

function buildParentIndex(nodes: readonly TreeNode[], parentRef: string | undefined, index: Map<string, string | undefined>): void {
  for (const node of nodes) {
    index.set(node.ref, parentRef);
    buildParentIndex(node.children, node.ref, index);
  }
}

interface TreeKeyboardMove {
  readonly nextFocusedRef: string;
  readonly nextExpanded?: ReadonlySet<string>;
}

function applyTreeKeyboardMove(key: string, focusedRef: string, forest: readonly TreeNode[], expanded: ReadonlySet<string>): TreeKeyboardMove | undefined {
  const rows = flattenVisible(forest, expanded);
  const refs = rows.map((row) => row.node.ref);
  const index = refs.indexOf(focusedRef);
  if (index === -1) return undefined;

  if (key === 'ArrowDown') return refs[index + 1] ? { nextFocusedRef: refs[index + 1]! } : undefined;
  if (key === 'ArrowUp') return refs[index - 1] ? { nextFocusedRef: refs[index - 1]! } : undefined;
  if (key === 'Home') return refs[0] ? { nextFocusedRef: refs[0]! } : undefined;
  if (key === 'End') return refs[refs.length - 1] ? { nextFocusedRef: refs[refs.length - 1]! } : undefined;

  if (key === 'ArrowRight') {
    const row = rows[index];
    if (!row?.hasChildren) return undefined;
    if (!expanded.has(focusedRef)) return { nextFocusedRef: focusedRef, nextExpanded: new Set([...expanded, focusedRef]) };
    const firstChildRef = row.node.children[0]?.ref;
    return firstChildRef ? { nextFocusedRef: firstChildRef } : undefined;
  }

  if (key === 'ArrowLeft') {
    if (expanded.has(focusedRef)) {
      const next = new Set(expanded);
      next.delete(focusedRef);
      return { nextFocusedRef: focusedRef, nextExpanded: next };
    }
    const parents = new Map<string, string | undefined>();
    buildParentIndex(forest, undefined, parents);
    const parentRef = parents.get(focusedRef);
    return parentRef ? { nextFocusedRef: parentRef } : undefined;
  }

  return undefined;
}

export interface FeatureTreeProps {
  readonly forest: readonly TreeNode[];
  readonly selectedRef: string;
  readonly driftRefs: ReadonlySet<string>;
  /** SDD-079 D5: las filas huérfanas llevan el badge «Sin código». */
  readonly orphanRefs: ReadonlySet<string>;
  /** Bumping this collapses every expandable row -- WO-457's "Contraer todo". */
  readonly collapseSignal: number;
  readonly onSelect: (ref: string) => void;
}

/** Keyboard-navigable ARIA tree (`role="tree"`/`"treeitem"`) of a project's features. Closed features are
 * dimmed unless selected; a feature named in `driftRefs` gets the canvas's yellow drift dot, and one named
 * in `orphanRefs` gets the «Sin código» badge. */
export function FeatureTree({ forest, selectedRef, driftRefs, orphanRefs, collapseSignal, onSelect }: FeatureTreeProps): ReactElement {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(collectExpandableRefs(forest)));
  const [focusedRef, setFocusedRef] = useState(selectedRef);
  const treeRef = useRef<HTMLDivElement>(null);
  const isFirstCollapseSignal = useRef(true);

  useEffect(() => setFocusedRef(selectedRef), [selectedRef]);

  useEffect(() => {
    if (isFirstCollapseSignal.current) {
      isFirstCollapseSignal.current = false;
      return;
    }
    setExpanded(new Set());
  }, [collapseSignal]);

  // WO-678 (rework del gate WO-679): el bosque cambia sin remount cuando el usuario tipea en el buscador
  // (`?q=`) o prende/apaga el chip «Sin código» (ambos viven en la URL). Recalcular acá la expansión por
  // defecto sobre el bosque nuevo evita que un nodo con hijos que no estaba en el bosque anterior quede
  // colapsado: así «N resultados» del header (SDD-083 D2) sigue siendo el número de filas que se ven.
  // «Contraer todo» (WO-457) no se pisa: el bosque no cambia al apretarlo.
  const isFirstForest = useRef(true);
  useEffect(() => {
    if (isFirstForest.current) {
      isFirstForest.current = false;
      return;
    }
    setExpanded(new Set(collectExpandableRefs(forest)));
  }, [forest]);

  useEffect(() => {
    treeRef.current?.querySelector<HTMLDivElement>(`[data-ref="${CSS.escape(focusedRef)}"]`)?.focus();
  }, [focusedRef]);

  const rows = useMemo(() => flattenVisible(forest, expanded), [forest, expanded]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(focusedRef);
      return;
    }
    if (!MOVE_KEYS.has(event.key)) return;
    event.preventDefault();
    const result = applyTreeKeyboardMove(event.key, focusedRef, forest, expanded);
    if (!result) return;
    if (result.nextExpanded) setExpanded(result.nextExpanded);
    setFocusedRef(result.nextFocusedRef);
  }

  return (
    <div ref={treeRef} role="tree" aria-label="Árbol de features" onKeyDown={handleKeyDown} className={styles.tree}>
      {rows.map((row) => {
        const isSelected = row.node.ref === selectedRef;
        const isClosed = row.node.status === 'closed';
        const rowClassName = [styles.row, isClosed ? styles.rowClosed : null, isSelected ? styles.rowSelected : null].filter((value): value is string => Boolean(value)).join(' ');
        return (
          <div
            key={row.node.ref}
            data-ref={row.node.ref}
            role="treeitem"
            tabIndex={row.node.ref === focusedRef ? 0 : -1}
            aria-selected={isSelected}
            aria-expanded={row.hasChildren ? expanded.has(row.node.ref) : undefined}
            aria-level={row.depth + 1}
            aria-setsize={row.setSize}
            aria-posinset={row.posInSet}
            onClick={() => onSelect(row.node.ref)}
            onFocus={() => setFocusedRef(row.node.ref)}
            className={rowClassName}
            style={{ '--depth': row.depth } as CSSProperties}
          >
            <span className={`id ${styles.rowId}`}>{row.node.ref}</span>
            <span className={styles.rowTitle}>{row.node.title}</span>
            {orphanRefs.has(row.node.ref) ? <span className={styles.orphanBadge}>Sin código</span> : null}
            {driftRefs.has(row.node.ref) ? (
              <span title="Drift activo" className={styles.drift}>
                <span className={styles.driftDot} />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
