/**
 * Expand/focus/selection state and keyboard navigation for the ARIA tree in FeatureTree (WO-283).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import type { Feature } from '../../data';
import { applyKeyboardMove, buildTree, expandableIds, flattenVisible, type VisibleRow } from './tree';

const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export interface UseFeatureTreeStateResult {
  readonly rows: readonly VisibleRow[];
  readonly expanded: ReadonlySet<string>;
  readonly focusedId: string;
  readonly setFocusedId: (id: string) => void;
  readonly closedCount: number;
  readonly allCollapsed: boolean;
  readonly toggleAll: () => void;
  readonly selectAndNavigate: (id: string) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly treeRef: RefObject<HTMLDivElement | null>;
}

export function useFeatureTreeState(features: readonly Feature[], selectedId: string): UseFeatureTreeStateResult {
  const navigate = useNavigate();
  const allExpandable = useMemo(() => expandableIds(features), [features]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(allExpandable));
  const [focusedId, setFocusedId] = useState(selectedId);
  const treeRef = useRef<HTMLDivElement>(null);
  const pendingFrame = useRef<number | null>(null);

  useEffect(() => {
    setFocusedId((current) => (features.some((feature) => feature.id === current) ? current : selectedId));
  }, [selectedId, features]);

  useEffect(() => {
    return () => {
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    };
  }, []);

  const tree = useMemo(() => buildTree(features), [features]);
  const rows = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);
  const closedCount = features.filter((feature) => feature.status === 'closed').length;
  const allCollapsed = allExpandable.every((id) => !expanded.has(id));

  function focusRow(id: string): void {
    setFocusedId(id);
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null;
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

  return { rows, expanded, focusedId, setFocusedId, closedCount, allCollapsed, toggleAll, selectAndNavigate, handleKeyDown, treeRef };
}
