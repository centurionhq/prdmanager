/**
 * Code refs (WO-272): the sync state of governed paths used by the work orders. Mirrors the
 * "Código gobernado" panel of canvas/Ordenes.dc.html for WO-310 exactly (scan.ts out of sync,
 * the CLI command still synced).
 */
import type { CodeRef } from './types';

export const CODE_REFS: readonly CodeRef[] = [
  { key: 'cli-import-command', path: 'packages/cli/src/commands/import.ts', blueprintId: 'SDD-012', status: 'synced', reason: 'unchanged' },
  { key: 'server-import-scan', path: 'packages/server/src/import/scan.ts', blueprintId: 'SDD-012', status: 'out_of_sync', reason: 'code_changed' },
  { key: 'server-import-hash-table', path: 'packages/server/src/import/hash-table.ts', blueprintId: 'SDD-012', status: 'out_of_sync', reason: 'code_changed' },
  { key: 'design-tokens-css', path: 'design/centurion-factory/src/styles/tokens.css', blueprintId: 'SDD-011', status: 'synced', reason: 'new' },
  { key: 'design-router', path: 'design/centurion-factory/src/app/router.tsx', blueprintId: 'SDD-011', status: 'out_of_sync', reason: 'missing' },
  { key: 'design-status-badge', path: 'design/centurion-factory/src/components/StatusBadge.tsx', blueprintId: 'SDD-011', status: 'out_of_sync', reason: 'missing' },
  { key: 'web-graph-canvas', path: 'packages/web/src/components/GraphCanvas.tsx', blueprintId: 'SDD-005', status: 'synced', reason: 'resolved_by_commit' },
  { key: 'web-to-elements', path: 'packages/web/src/lib/to-elements.ts', blueprintId: 'SDD-005', status: 'synced', reason: 'unchanged' },
  { key: 'server-permissions', path: 'packages/server/src/auth/permissions.ts', blueprintId: 'SDD-006', status: 'synced', reason: 'unchanged' },
  { key: 'app-tokens-page', path: 'packages/app/src/routes/settings/tokens.tsx', blueprintId: 'SDD-006', status: 'synced', reason: 'resolved_by_commit' },
  { key: 'server-document-workflow', path: 'packages/server/src/documents/workflow.ts', blueprintId: 'SDD-007', status: 'synced', reason: 'unchanged' },
  { key: 'server-drift-acknowledge', path: 'packages/server/src/drift/acknowledge.ts', blueprintId: 'SDD-007', status: 'synced', reason: 'unchanged' },
  { key: 'app-feature-close', path: 'packages/app/src/routes/features/close.tsx', blueprintId: 'SDD-007', status: 'out_of_sync', reason: 'blueprint_changed' },
  { key: 'collab-comments', path: 'packages/collab/src/comments.ts', blueprintId: 'SDD-008', status: 'synced', reason: 'unchanged' },
  { key: 'app-drift-view', path: 'packages/app/src/routes/drift.tsx', blueprintId: 'SDD-010', status: 'synced', reason: 'feature_changed' },
];

export function codeRefsForBlueprint(blueprintId: string): readonly CodeRef[] {
  return CODE_REFS.filter((ref) => ref.blueprintId === blueprintId);
}
