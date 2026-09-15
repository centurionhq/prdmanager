// SDD-006 "Dashboard (shell)": public surface of @prdm/ui — extracted from packages/web's src/client (PRD-004).
// Consumed directly as TypeScript source (no build step), exactly like @prdm/core is consumed by packages/cli.
export { toElements } from './graph/to-elements';
export { applyDrift, collectDriftIds } from './graph/apply-drift';
export { useCytoscape } from './hooks/useCytoscape';
export type { CytoscapeFactory, UseCytoscapeOptions } from './hooks/useCytoscape';
export { useGraphData } from './hooks/useGraphData';
export type { GraphDataState, GraphDataStatus } from './hooks/useGraphData';
export { SelectionProvider, useSelection } from './state/selection';
export type { SelectionState, SelectionProviderProps } from './state/selection';
export { buildGraphStylesheet } from './styles/graph-stylesheet';
export { GraphCanvas } from './components/GraphCanvas';
export type { GraphCanvasProps } from './components/GraphCanvas';
export { TreeView } from './components/TreeView';
export type { TreeViewProps } from './components/TreeView';
export { NodeDetailPanel } from './components/NodeDetailPanel';
export type { NodeDetailPanelProps } from './components/NodeDetailPanel';
export { WorkOrderList } from './components/WorkOrderList';
export type { WorkOrderListProps } from './components/WorkOrderList';
export { DriftBanner } from './components/DriftBanner';
export type { DriftBannerProps } from './components/DriftBanner';
export { EmptyState, ErrorState, LoadingState } from './components/StatusState';
