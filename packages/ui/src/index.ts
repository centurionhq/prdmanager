// SDD-006 "Dashboard (shell)": public surface of @prdm/ui — extracted from packages/web's src/client (PRD-004).
// Consumed directly as TypeScript source (no build step), exactly like @prdm/core is consumed by packages/cli.
export { toElements } from './graph/to-elements';
export { applyDrift, collectDriftIds } from './graph/apply-drift';
export { useCytoscape } from './hooks/useCytoscape';
export type { CytoscapeFactory, UseCytoscapeOptions } from './hooks/useCytoscape';
