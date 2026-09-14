import { createContext, createElement, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

export interface SelectionState {
  /** The active node id, or `null` when nothing is selected. */
  selectedId: string | null;
  select: (id: string | null) => void;
}

// `null` default (rather than a no-op stub) so `useSelection()` outside a provider fails loudly instead of
// silently doing nothing — a missing `SelectionProvider` is a wiring bug, not a valid empty state.
const SelectionContext = createContext<SelectionState | null>(null);

export interface SelectionProviderProps {
  children: ReactNode;
}

/**
 * `state/selection.ts` (SDD-005 "Frontend"): the single source of truth for the active node id, with no external
 * state library — `GraphCanvas`, the tree view, `SearchBar` and `NodeDetailPanel` all read/write through
 * `useSelection()` so selecting a node in any one of them highlights/opens it in the other three. Written as a
 * plain `.ts` module (via `createElement` instead of JSX) per this WO's filename.
 */
export function SelectionProvider({ children }: SelectionProviderProps): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const value = useMemo<SelectionState>(() => ({ selectedId, select: setSelectedId }), [selectedId]);
  return createElement(SelectionContext.Provider, { value }, children);
}

export function useSelection(): SelectionState {
  const context = useContext(SelectionContext);
  if (!context) throw new Error('useSelection() must be called within a <SelectionProvider>');
  return context;
}
