import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { RefreshReport, Subgraph } from '@prdm/core';
import { getDrift, getFullGraph, getProject, getTree, type TreeResponse, type WebProjectSummary } from './api/client';
import { DriftBanner } from './components/DriftBanner';
import { GraphCanvas } from './components/GraphCanvas';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { SearchBar } from './components/SearchBar';
import { ErrorState, LoadingState } from './components/StatusState';
import { TreeView } from './components/TreeView';
import { WorkOrderList } from './components/WorkOrderList';
import { collectDriftIds } from '@prdm/ui';
import { useGraphData } from './hooks/useGraphData';
import { SelectionProvider } from './state/selection';
import styles from './App.module.css';

const EMPTY_GRAPH: Subgraph = { nodes: [], edges: [] };
const EMPTY_DRIFT_IDS: ReadonlySet<string> = new Set();

function ExplorerShell(): ReactElement {
  const project = useGraphData<WebProjectSummary>(getProject);
  const graph = useGraphData<Subgraph>(getFullGraph);
  const tree = useGraphData<TreeResponse>(getTree);
  const drift = useGraphData<RefreshReport>(getDrift);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const refreshAll = useCallback(() => {
    graph.refetch();
    tree.refetch();
    drift.refetch();
    // no-op deps below: refetch() identities are stable per useGraphData (useCallback with []).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === '/' && document.activeElement !== searchInputRef.current) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const isRefreshing = graph.status === 'loading' || tree.status === 'loading' || drift.status === 'loading';
  // Recomputed only when drift data actually changes, not on every ExplorerShell render (F6 perf review) — was
  // previously a fresh Set every render, which would have blocked ever memoizing TreeView.
  const driftIds = useMemo(() => (drift.data ? collectDriftIds(drift.data) : EMPTY_DRIFT_IDS), [drift.data]);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <b>PRDM Explorer</b>
          {project.data && <span>{project.data.id}</span>}
        </div>
        <SearchBar inputRef={searchInputRef} />
        {project.data && (
          <div className={styles.metaBar} aria-label="Resumen del proyecto">
            {Object.entries(project.data.counts)
              .filter(([, count]) => count > 0)
              .map(([kind, count]) => (
                <span key={kind} className={styles.metaChip}>
                  {kind} {count}
                </span>
              ))}
          </div>
        )}
        {project.status === 'error' && <ErrorState error={project.error} onRetry={project.refetch} />}
      </header>

      {drift.status === 'ready' && drift.data && <DriftBanner report={drift.data} />}
      {drift.status === 'error' && <ErrorState error={drift.error} onRetry={drift.refetch} />}

      <div className={styles.grid}>
        {tree.status === 'ready' && tree.data ? (
          <TreeView forest={tree.data.forest} driftIds={driftIds} />
        ) : tree.status === 'error' ? (
          <ErrorState error={tree.error} onRetry={tree.refetch} />
        ) : (
          <LoadingState label="Cargando árbol…" />
        )}

        {graph.status === 'ready' ? (
          <GraphCanvas graph={graph.data ?? EMPTY_GRAPH} drift={drift.data} onRefresh={refreshAll} refreshing={isRefreshing} />
        ) : graph.status === 'error' ? (
          <ErrorState error={graph.error} onRetry={graph.refetch} />
        ) : (
          <LoadingState label="Cargando grafo…" />
        )}

        <NodeDetailPanel />
      </div>

      <WorkOrderList />
    </div>
  );
}

/** `App` (SDD-005 "Frontend"): the top-level layout — topbar, drift status, tree/canvas/detail, work orders. */
export function App(): ReactElement {
  return (
    <SelectionProvider>
      <ExplorerShell />
    </SelectionProvider>
  );
}
