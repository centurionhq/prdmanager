/**
 * Commit history (WO-272). 24 commits, all with `Refs:` trailers. Most shas reuse the
 * commitShas already recorded on the matching WorkOrder (see workOrdersCore.ts /
 * workOrdersSample.ts) so the two data sets cross-reference each other; this is a
 * representative sample of the repo's git log, not an exhaustive mirror of every WO's commits.
 */
import type { Commit } from './types';

export const COMMITS: readonly Commit[] = [
  { sha: 'a1b2c3d', subject: 'feat(web): add to-elements Subgraph to Cytoscape mapper', author: 'dev:martin', date: '2026-09-13T11:20:00.000Z', refs: ['WO-058'], files: ['packages/web/src/lib/to-elements.ts'] },
  { sha: 'b2c3d4e', subject: 'feat(web): add GraphCanvas with layout and refresh', author: 'dev:martin', date: '2026-09-13T14:40:00.000Z', refs: ['WO-064'], files: ['packages/web/src/components/GraphCanvas.tsx'] },
  { sha: 'c3d4e5f', subject: 'feat(web): add DriftBanner and drift node highlighting', author: 'agent:claude', date: '2026-09-13T18:05:00.000Z', refs: ['WO-069'], files: ['packages/web/src/components/DriftBanner.tsx', 'packages/web/src/lib/apply-drift.ts'] },
  { sha: 'd4e5f6a', subject: 'feat(server): add pure org/project permission matrix', author: 'agent:claude', date: '2026-09-13T20:50:00.000Z', refs: ['WO-106'], files: ['packages/server/src/auth/permissions.ts'] },
  { sha: 'e5f6a7b', subject: 'feat(app): add CI token page with one-time secret reveal', author: 'dev:martin', date: '2026-09-14T09:15:00.000Z', refs: ['WO-119'], files: ['packages/app/src/routes/settings/tokens.tsx'] },
  { sha: 'f6a7b8c', subject: 'feat(server): add document workflow state machine', author: 'agent:claude', date: '2026-09-14T12:00:00.000Z', refs: ['WO-136'], files: ['packages/server/src/documents/workflow.ts'] },
  { sha: 'a7b8c9d', subject: 'feat(server): add drift acknowledgement with audit trail', author: 'dev:martin', date: '2026-09-14T15:25:00.000Z', refs: ['WO-140'], files: ['packages/server/src/drift/acknowledge.ts'] },
  { sha: 'b8c9d0e', subject: 'feat(app): add feature close flow with closureReadiness', author: 'agent:claude', date: '2026-09-14T17:50:00.000Z', refs: ['WO-143'], files: ['packages/app/src/routes/features/close.tsx'] },
  { sha: 'c9d0e1f', subject: 'feat(collab): add anchored comment threads with Y.RelativePosition', author: 'agent:deepseek', date: '2026-09-14T20:10:00.000Z', refs: ['WO-158'], files: ['packages/collab/src/comments.ts', 'packages/server/src/documents/comments.ts'] },
  { sha: 'd0e1f2a', subject: 'feat(server): add idempotent POST code-reports endpoint', author: 'agent:claude', date: '2026-09-15T08:30:00.000Z', refs: ['WO-180'], files: ['packages/server/src/reports/code-reports.ts'] },
  { sha: 'e1f2a3b', subject: 'feat(app): add drift views for default branch and previews', author: 'dev:martin', date: '2026-09-15T09:40:00.000Z', refs: ['WO-199'], files: ['packages/app/src/routes/drift.tsx'] },
  { sha: 'f2a3b4c', subject: 'feat(import): add per-file hash table in Postgres', author: 'agent:claude', date: '2026-09-12T16:00:00.000Z', refs: ['WO-301'], files: ['packages/db/migrations/0031_import_file_hashes.sql', 'packages/server/src/import/hash-table.ts'] },
  { sha: 'a3b4c5d', subject: 'feat(import): detect deleted files between scans', author: 'agent:deepseek', date: '2026-09-11T15:30:00.000Z', refs: ['WO-302'], files: ['packages/server/src/import/hash-table.ts'] },
  { sha: '3c1a5af', subject: 'feat(cli): add importer summary with new/changed/deleted/skipped counts', author: 'agent:claude', date: '2026-09-14T09:50:00.000Z', refs: ['WO-310'], files: ['packages/cli/src/commands/import.ts', 'packages/server/src/import/scan.ts'] },
  { sha: '8f2c1d4', subject: 'wip(import): incremental scan and idempotent retry (in progress)', author: 'agent:claude', date: '2026-09-15T09:56:00.000Z', refs: ['WO-304', 'WO-307'], files: ['packages/server/src/import/scan.ts'] },
  { sha: '1a2b3c4', subject: 'feat(core): add unique id constraint per project in Neo4jGraphDatabase', author: 'agent:claude', date: '2026-09-12T14:00:00.000Z', refs: ['WO-012'], files: ['packages/core/src/graph/migrations.ts'] },
  { sha: '2b3c4d5', subject: 'feat(core): add Feature Tree traversal with cycle detection', author: 'agent:claude', date: '2026-09-12T17:30:00.000Z', refs: ['WO-021'], files: ['packages/core/src/graph/traverse.ts'] },
  { sha: '3c4d5e6', subject: 'feat(mcp): add read-only Feature Tree tools', author: 'dev:martin', date: '2026-09-13T10:15:00.000Z', refs: ['WO-034'], files: ['packages/mcp/src/tools-graph.ts'] },
  { sha: '4d5e6f7', subject: 'feat(core): add collision-free id allocation across projects', author: 'agent:claude', date: '2026-09-13T09:00:00.000Z', refs: ['WO-052'], files: ['packages/core/src/domain/id-allocator.ts'] },
  { sha: '5e6f708', subject: 'feat(core): add atomic disk+Neo4j write with rollback', author: 'agent:claude', date: '2026-09-13T13:10:00.000Z', refs: ['WO-061'], files: ['packages/core/src/engine.ts'] },
  { sha: '6f70819', subject: 'feat(core): add web-tree-sitter symbol extractor', author: 'agent:deepseek', date: '2026-09-13T16:00:00.000Z', refs: ['WO-088'], files: ['packages/core/src/sync/tree-sitter-extractor.ts'] },
  { sha: '708192a', subject: 'refactor(core): migrate to the tree-sitter extractor without baseline drift', author: 'agent:claude', date: '2026-09-13T19:20:00.000Z', refs: ['WO-095'], files: ['packages/core/src/sync/code-refs.ts'] },
  { sha: '8192a3b', subject: 'feat(core): add per-draft file with sliding TTL', author: 'agent:claude', date: '2026-09-13T21:00:00.000Z', refs: ['WO-101'], files: ['packages/core/src/authoring/draft-store.ts'] },
  { sha: '92a3b4c', subject: 'feat(core): add idempotent commit tombstones for drafts', author: 'dev:martin', date: '2026-09-14T08:30:00.000Z', refs: ['WO-112'], files: ['packages/core/src/authoring/draft-store.ts'] },
];
