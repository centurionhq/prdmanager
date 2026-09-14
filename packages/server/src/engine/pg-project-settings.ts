/**
 * Maps a Postgres `projects` row's `settings` jsonb (validated by `@prdm/contracts`'
 * `projectSettingsSchema`, SDD-006 §Modelo de datos) onto `@prdm/core`'s `ProjectSettings`
 * (SDD-007 "PgProjectEngine": `settings` sin `neo4j` ni `root`), the type every domain function
 * (`generateWorkOrders`, `claimWorkOrder`, ...) is typed against via `ProjectEngine`.
 *
 * Field-name translation only (contracts' schema is deliberately snake_case, mirroring the raw
 * `.prdm.yaml` shape a CLI import writes verbatim — see `packages/contracts/src/project-settings.ts`'s
 * own doc comment); no behavior beyond that. `docsDir` is always `'docs'` in SaaS (contracts'
 * `ProjectSettings` deliberately has no `docs_dir` field: a project's documents always live under the
 * server-managed `documents` table, never a real `docs/` folder on disk, so there is nothing for a
 * custom `docsDir` to rename) and `authoring` always gets `@prdm/core`'s local defaults (draft
 * TTL/limits aren't part of the dashboard's project settings screen either, same reasoning).
 */
import { projectSettingsSchema } from '@prdm/contracts';
import { DEFAULT_AUTHORING, foldersForDocsDir, type FolderMap, type PrdmConfig, type ProjectSettings } from '@prdm/core';
import type { ProjectRecord } from '@prdm/db';

/** SaaS projects never have a real `docs/` directory on disk; kept as a named constant since it also
 * seeds `foldersForDocsDir` and is asserted against in `PgProjectEngine.createDocument`'s folder check. */
export const SAAS_DOCS_DIR = 'docs';

/** Stable across every server instance/process/restart (SDD-007: "Huella `saas://project/<uuid>`, igual
 * en todas las instancias") — the Postgres `projects.id` UUID never changes for a project's lifetime,
 * unlike a `graph_project_id`/slug which could in principle be regenerated or reused. */
export function saasProjectRoot(projectId: string): string {
  return `saas://project/${projectId}`;
}

export function buildProjectSettings(project: ProjectRecord): ProjectSettings {
  const raw = projectSettingsSchema.parse(project.settings ?? {});
  const defaultFolders = foldersForDocsDir(SAAS_DOCS_DIR);
  const folders = Object.fromEntries(
    Object.entries(defaultFolders).map(([kind, def]) => [kind, raw.folders[kind as keyof typeof raw.folders] ?? def]),
  ) as FolderMap;

  return {
    project: { id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) },
    folders,
    git: { maxCommits: raw.git.max_commits, enforceRefs: raw.git.enforce_refs, enforceRefsSince: raw.git.enforce_refs_since },
    lifecycle: { grandfathered: raw.lifecycle.grandfathered },
    authoring: DEFAULT_AUTHORING,
    docsDir: SAAS_DOCS_DIR,
    ignore: raw.ignore,
    gitMaxCommits: raw.git.max_commits,
    triage: {
      autoLinkMinScore: raw.triage.auto_link_min_score,
      autoLinkMargin: raw.triage.auto_link_margin,
      maxCandidates: raw.triage.max_candidates,
      minMatchedTerms: raw.triage.min_matched_terms,
    },
  };
}

/** The full `PrdmConfig` a `PrdmDeps`-shaped MCP tool handler expects (SDD-010's remote MCP profile,
 * WO-184): `buildProjectSettings` plus the two fields `ProjectSettings` deliberately omits
 * (`root`/`neo4j` — SDD-007 "PgProjectEngine": neither is ever dereferenced for real disk/network I/O
 * by a SaaS-backed `EngineOps`, so both are inert placeholders, matching `PgProjectEngine`'s own
 * private `this.config` construction exactly). */
export function buildPrdmConfig(project: ProjectRecord): PrdmConfig {
  return {
    ...buildProjectSettings(project),
    root: saasProjectRoot(project.id),
    neo4j: { uri: 'saas://unused', username: 'unused', password: 'unused', database: 'unused' },
  };
}
