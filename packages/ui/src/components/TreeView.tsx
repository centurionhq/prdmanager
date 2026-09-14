import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { TreeNode } from '@prdm/core';
import { useSelection } from '../state/selection';
import styles from './TreeView.module.css';

export interface TreeViewProps {
  forest: TreeNode[];
  /** Ids the last drift report flagged (SDD-005 "Frontend"): badges the tree entry the same way the canvas does. */
  driftIds: ReadonlySet<string>;
}

interface FlatRow {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

function statusGroup(status: string | null): 'attention' | null {
  return status === 'out_of_sync' ? 'attention' : null;
}

/** Depth-first, respecting `expanded`, so arrow-key Up/Down moves through exactly what's on screen. */
function flatten(forest: TreeNode[], expanded: ReadonlySet<string>, depth = 0): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of forest) {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.ref);
    rows.push({ node, depth, hasChildren, expanded: isExpanded });
    if (hasChildren && isExpanded) rows.push(...flatten(node.children, expanded, depth + 1));
  }
  return rows;
}

function collectAllRefs(forest: TreeNode[]): string[] {
  return forest.flatMap((node) => [node.ref, ...collectAllRefs(node.children)]);
}

/** The chain of ancestor refs (root-first, excluding `targetRef` itself) that must be expanded for it to be visible, or `null` if it isn't in `forest` at all. */
function findAncestors(forest: TreeNode[], targetRef: string, path: string[] = []): string[] | null {
  for (const node of forest) {
    if (node.ref === targetRef) return path;
    const found = findAncestors(node.children, targetRef, [...path, node.ref]);
    if (found) return found;
  }
  return null;
}

/** Small inline glyphs (never emoji — SDD-005 / ui-ux-pro-max "Style Selection"), shape-coded to match `graph-stylesheet.ts`. */
function Glyph({ label, drift }: { label: string; drift: boolean }): ReactElement {
  if (drift) {
    return (
      <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1 11.5 11h-11Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  switch (label) {
    case 'Blueprint':
      return (
        <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1 6 3.5 2h5L11 6 8.5 10h-5Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case 'WorkOrder':
      return (
        <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
          <ellipse cx="6" cy="6" rx="5" ry="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case 'Feedback':
    case 'Artifact':
      return (
        <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
          <polygon points="6,1 11,6 6,11 1,6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    default:
      return (
        <svg className={styles.glyph} viewBox="0 0 12 12" aria-hidden="true">
          <rect x="1" y="2.5" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
  }
}

/**
 * `components/TreeView.tsx` (SDD-005 "Frontend"): the keyboard-accessible alternative to the Cytoscape canvas —
 * a WAI-ARIA tree (`role="tree"`/`treeitem`/`group`) with roving tabindex. Arrow Up/Down moves and selects the
 * next visible row; Right expands (or moves into) a node with children, Left collapses (or moves to the parent).
 * Selection is shared with the canvas/search/detail panel via `useSelection()`.
 */
export function TreeView({ forest, driftIds }: TreeViewProps): ReactElement {
  const { selectedId, select } = useSelection();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(collectAllRefs(forest)));
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  const rows = useMemo(() => flatten(forest, expanded), [forest, expanded]);
  const activeId = selectedId && rows.some((r) => r.node.ref === selectedId) ? selectedId : (rows[0]?.node.ref ?? null);

  // A selection made from outside the tree (search, canvas tap, a relation link) must still become visible here,
  // even under a branch the user manually collapsed with ArrowLeft — otherwise the roving tabindex silently lands
  // on an unrelated row and the real selection is never rendered at all (F6 accessibility review).
  useEffect(() => {
    if (!selectedId) return;
    const ancestors = findAncestors(forest, selectedId);
    if (!ancestors) return;
    const missing = ancestors.filter((id) => !expanded.has(id));
    if (missing.length === 0) return;
    setExpanded((prev) => new Set([...prev, ...missing]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `expanded` is read, not a trigger: including it would loop this effect with its own setExpanded call.
  }, [selectedId, forest]);

  useEffect(() => {
    // jsdom (this repo's test environment) doesn't implement scrollIntoView at all, unlike every real browser.
    itemRefs.current.get(selectedId ?? '')?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, rows]);

  function focusRow(id: string): void {
    select(id);
    itemRefs.current.get(id)?.focus();
  }

  function toggle(id: string, next?: boolean): void {
    setExpanded((prev) => {
      const copy = new Set(prev);
      const shouldExpand = next ?? !copy.has(id);
      if (shouldExpand) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, row: FlatRow, index: number): void {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = rows[index + 1];
        if (next) focusRow(next.node.ref);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prev = rows[index - 1];
        if (prev) focusRow(prev.node.ref);
        break;
      }
      case 'ArrowRight':
        event.preventDefault();
        if (row.hasChildren && !row.expanded) toggle(row.node.ref, true);
        else if (row.hasChildren) focusRow(row.node.children[0]!.ref);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.hasChildren && row.expanded) toggle(row.node.ref, false);
        else {
          const parent = [...rows.slice(0, index)].reverse().find((r) => r.depth === row.depth - 1);
          if (parent) focusRow(parent.node.ref);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        select(row.node.ref);
        break;
      case 'Home': {
        event.preventDefault();
        const first = rows[0];
        if (first) focusRow(first.node.ref);
        break;
      }
      case 'End': {
        event.preventDefault();
        const last = rows[rows.length - 1];
        if (last) focusRow(last.node.ref);
        break;
      }
    }
  }

  function renderRow(row: FlatRow, index: number): ReactElement {
    const { node } = row;
    const isActive = node.ref === activeId;
    const isSelected = node.ref === selectedId;
    const drift = driftIds.has(node.ref);
    return (
      <div
        key={node.ref}
        ref={(el) => {
          if (el) itemRefs.current.set(node.ref, el);
          else itemRefs.current.delete(node.ref);
        }}
        role="treeitem"
        id={`tree-item-${node.ref}`}
        aria-selected={isSelected}
        aria-expanded={row.hasChildren ? row.expanded : undefined}
        aria-level={row.depth + 1}
        tabIndex={isActive ? 0 : -1}
        data-drift={drift || undefined}
        data-status-group={statusGroup(node.status) ?? undefined}
        className={styles.item}
        style={{ paddingLeft: `calc(${row.depth} * var(--space-md) + var(--space-sm))` }}
        onClick={() => select(node.ref)}
        onKeyDown={(event) => handleKeyDown(event, row, index)}
      >
        <Glyph label={node.label} drift={drift} />
        <span className={styles.title}>
          <strong style={{ fontWeight: 600, opacity: 1 }}>{node.ref}</strong> {node.title}
        </span>
      </div>
    );
  }

  return (
    <nav className={styles.panel} aria-label="Árbol de features">
      <p className={styles.eyebrow}>Feature Tree</p>
      <div role="tree" aria-label="Documentos del proyecto" className={styles.tree}>
        {rows.map((row, index) => renderRow(row, index))}
      </div>
    </nav>
  );
}
