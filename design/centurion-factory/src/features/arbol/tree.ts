/**
 * Pure Feature Tree helpers (WO-283): build the evolvesFrom hierarchy and flatten it into the
 * visible rows a keyboard tree needs, with the aria-level/setsize/posinset triad. Kept free of
 * React so the traversal and keyboard math are unit-testable on their own.
 */
import type { Feature } from '../../data';

export interface TreeNode {
  readonly feature: Feature;
  readonly children: readonly TreeNode[];
}

/** Groups features by `evolvesFrom`, preserving the order they appear in `features`. */
export function buildTree(features: readonly Feature[]): readonly TreeNode[] {
  function childrenOf(parentId: string | undefined): readonly TreeNode[] {
    return features.filter((feature) => feature.evolvesFrom === parentId).map((feature) => ({ feature, children: childrenOf(feature.id) }));
  }

  return childrenOf(undefined);
}

export interface VisibleRow {
  readonly feature: Feature;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly setSize: number;
  readonly posInSet: number;
}

/** Flattens the tree into the rows currently visible, skipping the children of collapsed nodes. */
export function flattenVisible(nodes: readonly TreeNode[], expanded: ReadonlySet<string>, depth = 0): readonly VisibleRow[] {
  return nodes.flatMap((node, index) => {
    const row: VisibleRow = {
      feature: node.feature,
      depth,
      hasChildren: node.children.length > 0,
      setSize: nodes.length,
      posInSet: index + 1,
    };
    const isExpanded = node.children.length === 0 || expanded.has(node.feature.id);
    return isExpanded ? [row, ...flattenVisible(node.children, expanded, depth + 1)] : [row];
  });
}

/** Every feature id that has at least one child, i.e. every id that can be expanded/collapsed. */
export function expandableIds(features: readonly Feature[]): readonly string[] {
  const parents = new Set(features.map((feature) => feature.evolvesFrom).filter((id): id is string => Boolean(id)));
  return [...parents];
}

function parentIdOf(features: readonly Feature[], id: string): string | undefined {
  return features.find((feature) => feature.id === id)?.evolvesFrom;
}

export interface KeyboardMoveOptions {
  readonly key: string;
  readonly focusedId: string;
  readonly features: readonly Feature[];
  readonly expanded: ReadonlySet<string>;
}

export interface KeyboardMoveResult {
  /** The id focus should move to; unchanged when the key does not move focus. */
  readonly nextFocusedId: string;
  /** Set when the key also changes which ids are expanded. */
  readonly nextExpanded?: ReadonlySet<string>;
}

/**
 * Applies the ARIA treeview keyboard model for a single keydown: Arrow Up/Down move focus among
 * visible rows, Arrow Right expands or moves into the first child, Arrow Left collapses or moves
 * to the parent, and Home/End jump to the ends of the visible list.
 */
export function applyKeyboardMove(options: KeyboardMoveOptions): KeyboardMoveResult | undefined {
  const { key, focusedId, features, expanded } = options;
  const tree = buildTree(features);
  const rows = flattenVisible(tree, expanded);
  const ids = rows.map((row) => row.feature.id);
  const index = ids.indexOf(focusedId);
  if (index === -1) return undefined;

  if (key === 'ArrowDown') {
    const next = ids[Math.min(index + 1, ids.length - 1)];
    return next ? { nextFocusedId: next } : undefined;
  }

  if (key === 'ArrowUp') {
    const next = ids[Math.max(index - 1, 0)];
    return next ? { nextFocusedId: next } : undefined;
  }

  if (key === 'Home') {
    const next = ids[0];
    return next ? { nextFocusedId: next } : undefined;
  }

  if (key === 'End') {
    const next = ids[ids.length - 1];
    return next ? { nextFocusedId: next } : undefined;
  }

  if (key === 'ArrowRight') {
    const row = rows[index];
    if (!row) return undefined;
    if (!row.hasChildren) return undefined;
    if (!expanded.has(focusedId)) {
      return { nextFocusedId: focusedId, nextExpanded: new Set([...expanded, focusedId]) };
    }
    const firstChildId = features.find((feature) => feature.evolvesFrom === focusedId)?.id;
    return firstChildId ? { nextFocusedId: firstChildId } : undefined;
  }

  if (key === 'ArrowLeft') {
    if (expanded.has(focusedId)) {
      const next = new Set(expanded);
      next.delete(focusedId);
      return { nextFocusedId: focusedId, nextExpanded: next };
    }
    const parentId = parentIdOf(features, focusedId);
    return parentId ? { nextFocusedId: parentId } : undefined;
  }

  return undefined;
}
