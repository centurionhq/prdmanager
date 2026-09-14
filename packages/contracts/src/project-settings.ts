/**
 * `projects.settings` validation (SDD-006 §Modelo de datos, WO-107): "settings jsonb (subset validado de
 * `.prdm.yaml`: folders, lifecycle.grandfathered, git, triage, ignore, `default_branch`,
 * `github_repository`, `github_repository_id`, `github_owner_id`, `hash_algo_version`)".
 *
 * This mirrors the *shape and field names* (including the `.prdm.yaml` snake_case keys, since this is
 * the same subset a CLI import/sync writes verbatim — SDD-010) of `@prdm/core`'s
 * `packages/core/src/project/file.ts` (`rawProjectFileSchema`'s `folders`/`git`/`triage`/`lifecycle`/
 * `ignore` fields), deliberately re-declared rather than imported: `packages/contracts` has no
 * dependency on `@prdm/core` (SDD-006 §Arquitectura's one-way dependency graph keeps `core` and
 * `contracts` as independent leaves that both feed `server`/`app`), the same reason
 * `packages/db/src/schema/user-profile.ts` hand-syncs `@prdm/core`'s `ACTOR_PATTERN` instead of
 * importing it. `docs_dir`, `project.{id,name}` and `authoring` are deliberately NOT part of this
 * subset (SDD-006 names exactly the fields listed above) — a project's identity lives in the `projects`
 * table columns themselves, and per-draft authoring limits aren't part of what the dashboard's project
 * settings screen edits.
 */
import { z } from 'zod';

/** Kept in sync by hand with `@prdm/core`'s `DOC_KINDS` (`packages/core/src/domain/schema.ts`). */
const DOC_KINDS = ['MRD', 'PRD', 'FR', 'SDD', 'ADR', 'WO', 'ART', 'FB'] as const;

/** Kept in sync by hand with `@prdm/core`'s `ID_PATTERN`. */
const DOC_ID_PATTERN = /^(MRD|PRD|FR|SDD|ADR|WO|ART|FB)-\d{3,9}$/;
/** Kept in sync by hand with `@prdm/core`'s `SHA_PATTERN` (git commit sha, 7-40 hex chars). */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
/** Kept in sync by hand with the 64-hex-char content hash pattern `@prdm/core`'s `file.ts` uses for
 * `lifecycle.grandfathered[].hash`. */
const HASH64_PATTERN = /^[0-9a-f]{64}$/;

const docIdSchema = z.string().regex(DOC_ID_PATTERN, 'invalid document id (expected e.g. PRD-001)');

const folderShape = Object.fromEntries(DOC_KINDS.map((kind) => [kind, z.string().min(1).optional()])) as Record<
  (typeof DOC_KINDS)[number],
  z.ZodOptional<z.ZodString>
>;

const foldersSchema = z.strictObject(folderShape).prefault({});

const grandfatheredDocSchema = z.strictObject({
  id: docIdSchema,
  hash: z.string().regex(HASH64_PATTERN, 'expected 64 hex characters'),
});

const lifecycleSchema = z
  .strictObject({
    grandfathered: z.array(grandfatheredDocSchema).default([]),
  })
  .prefault({});

const gitSettingsSchema = z
  .strictObject({
    max_commits: z.number().int().positive().max(100_000).default(500),
    enforce_refs: z.boolean().default(true),
    enforce_refs_since: z.union([z.string().regex(SHA_PATTERN), z.null()]).default(null),
  })
  .prefault({});

const triageSettingsSchema = z
  .strictObject({
    auto_link_min_score: z.number().positive().default(0.5),
    auto_link_margin: z.number().min(1).default(1.05),
    max_candidates: z.number().int().min(1).max(50).default(5),
    min_matched_terms: z.number().int().min(0).default(2),
  })
  .prefault({});

/** `owner/repo` shorthand, same shape GitHub itself uses in API responses' `full_name`. */
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export const projectSettingsSchema = z.strictObject({
  folders: foldersSchema,
  ignore: z.array(z.string().min(1)).default([]),
  git: gitSettingsSchema,
  triage: triageSettingsSchema,
  lifecycle: lifecycleSchema,
  default_branch: z.string().min(1).max(255).default('main'),
  github_repository: z.string().regex(GITHUB_REPOSITORY_PATTERN, 'expected "owner/repo"').nullable().default(null),
  github_repository_id: z.number().int().positive().nullable().default(null),
  github_owner_id: z.number().int().positive().nullable().default(null),
  hash_algo_version: z.number().int().positive().default(1),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
