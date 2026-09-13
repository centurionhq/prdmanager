import type { ReactElement } from 'react';

/**
 * PRD-004 / SDD-005: infrastructure-only placeholder. `GraphCanvas`, the tree view, `SearchBar`,
 * `NodeDetailPanel` and `WorkOrderList` land in a later phase; this only proves the Vite/React
 * shell builds and mounts.
 */
export function App(): ReactElement {
  return (
    <main>
      <h1>PRD Manager Explorer</h1>
      <p>Frontend infrastructure scaffold (PRD-004). The graph explorer UI lands in a later phase.</p>
    </main>
  );
}
