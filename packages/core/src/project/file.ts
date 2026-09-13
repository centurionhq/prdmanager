import { randomBytes } from 'node:crypto';
import { isAlias, parseDocument, stringify, visit, type Document, type DocumentOptions, type ParseOptions, type SchemaOptions } from 'yaml';
import { z } from 'zod';
import { DOC_KINDS, SHA_PATTERN, docId, type DocKind } from '../domain/schema.js';
import {
  DEFAULT_FOLDERS,
  PROJECT_ID_PATTERN,
  type AuthoringSettings,
  type FolderMap,
  type GitSettings,
  type GrandfatheredDoc,
  type LifecycleSettings,
} from './types.js';

/** `.prdm.yaml` beyond this size is refused before it is even parsed (SDD-002 "Seguridad"). */
export const MAX_PROJECT_FILE_BYTES = 64 * 1024;

const HASH64_PATTERN = /^[0-9a-f]{64}$/;
/** Any key matching this (anywhere in the file) is refused: secrets belong in `.env`/the environment, never in `.prdm.yaml`. */
const SECRET_KEY_PATTERN = /neo4j|password|secret/i;

/** yaml@2.9.1 parse options locked down per ADR-002 D7/D8: no custom tags, no aliases, unique keys, strict, YAML 1.2 core schema. */
const YAML_PARSE_OPTIONS: ParseOptions & DocumentOptions & SchemaOptions = {
  schema: 'core',
  customTags: [],
  merge: false,
  uniqueKeys: true,
  strict: true,
  prettyErrors: true,
  version: '1.2',
};

/** `maxAliasCount` only takes effect when resolving a document to JS, not while parsing it (belt-and-suspenders alongside {@link hasAnchorOrAlias}). */
const YAML_TO_JS_OPTIONS = { mapAsMap: false, maxAliasCount: 0 };

export interface TriageSettings {
  autoLinkMinScore: number;
  autoLinkMargin: number;
  maxCandidates: number;
  minMatchedTerms: number;
}

/** Camel-cased, validated contents of `.prdm.yaml` (the file itself uses snake_case). */
export interface ProjectFileSettings {
  project: { id: string; name: string };
  docsDir: string;
  folders: FolderMap;
  ignore: string[];
  git: GitSettings;
  triage: TriageSettings;
  lifecycle: LifecycleSettings;
  authoring: AuthoringSettings;
}

function isPrintableName(name: string): boolean {
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

const projectIdSchema = z.string().regex(PROJECT_ID_PATTERN, 'invalid project id (expected prj_ followed by 16 hex chars)');
const projectNameSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isPrintableName, 'must be printable text with no line breaks or control characters');

const folderShape = Object.fromEntries(DOC_KINDS.map((kind) => [kind, z.string().min(1).optional()])) as Record<DocKind, z.ZodOptional<z.ZodString>>;

const gitFileSchema = z
  .strictObject({
    max_commits: z.number().int().positive().max(100_000).default(500),
    enforce_refs: z.boolean().default(true),
    enforce_refs_since: z.union([z.string().regex(SHA_PATTERN), z.null()]).default(null),
  })
  .prefault({});

const triageFileSchema = z
  .strictObject({
    auto_link_min_score: z.number().positive().default(0.5),
    auto_link_margin: z.number().min(1).default(1.05),
    max_candidates: z.number().int().min(1).max(50).default(5),
    min_matched_terms: z.number().int().min(0).default(2),
  })
  .prefault({});

const grandfatheredFileSchema = z.strictObject({
  id: docId,
  hash: z.string().regex(HASH64_PATTERN, 'expected 64 hex characters'),
});

const lifecycleFileSchema = z
  .strictObject({
    grandfathered: z.array(grandfatheredFileSchema).default([]),
  })
  .prefault({});

const authoringFileSchema = z
  .strictObject({
    draft_ttl_minutes: z.number().int().min(1).max(1440).default(60),
    max_drafts: z.number().int().min(1).max(200).default(20),
    max_draft_bytes: z.number().int().min(1024).max(1_048_576).default(262_144),
  })
  .prefault({});

const rawProjectFileSchema = z.strictObject({
  version: z.literal(1),
  project: z.strictObject({ id: projectIdSchema, name: projectNameSchema }),
  docs_dir: z.string().min(1).default('docs'),
  folders: z.strictObject(folderShape).prefault({}),
  ignore: z.array(z.string().min(1)).default([]),
  git: gitFileSchema,
  triage: triageFileSchema,
  lifecycle: lifecycleFileSchema,
  authoring: authoringFileSchema,
});

type RawProjectFile = z.infer<typeof rawProjectFileSchema>;

function assertSafeRelativePath(label: string, path: string): void {
  if (path.includes('\0')) throw new Error(`${label}: must not contain NUL bytes`);
  if (path.includes('\\')) throw new Error(`${label}: must use forward slashes`);
  if (path.startsWith('/')) throw new Error(`${label}: must be a relative path`);
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label}: must not contain "." or ".." segments`);
  }
}

function assertFolderPath(kind: string, path: string, docsDir: string): void {
  assertSafeRelativePath(`folders.${kind}`, path);
  if (!path.startsWith(`${docsDir}/`)) throw new Error(`folders.${kind}: must be inside "${docsDir}" (expected to start with "${docsDir}/")`);
}

/** Recursively rejects keys that look like secrets anywhere in the parsed document; those belong in `.env`/the environment. */
function assertNoSecretKeys(value: unknown, path: string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`"${[...path, key].join('.')}" is not allowed; secrets belong in .env`);
    assertNoSecretKeys(child, [...path, key]);
  }
}

function hasUnresolvedTag(doc: Document): boolean {
  return doc.warnings.some((warning) => (warning as { code?: string }).code === 'TAG_RESOLVE_FAILED');
}

/** Anchors and aliases are both rejected: `maxAliasCount: 0` only throws when an alias is *resolved*, so the tree is walked up front. */
function hasAnchorOrAlias(doc: Document): boolean {
  let found = false;
  visit(doc, (_key, node) => {
    if (isAlias(node)) {
      found = true;
      return visit.BREAK;
    }
    if (node && typeof node === 'object' && 'anchor' in node && (node as { anchor?: string }).anchor) {
      found = true;
      return visit.BREAK;
    }
    return undefined;
  });
  return found;
}

function mergeFolders(overrides: Partial<FolderMap>): FolderMap {
  return { ...DEFAULT_FOLDERS, ...overrides } as FolderMap;
}

function toSettings(raw: RawProjectFile): ProjectFileSettings {
  const folders = mergeFolders(raw.folders as Partial<FolderMap>);
  assertSafeRelativePath('docs_dir', raw.docs_dir);
  for (const kind of DOC_KINDS) assertFolderPath(kind, folders[kind], raw.docs_dir);

  return {
    project: raw.project,
    docsDir: raw.docs_dir,
    folders,
    ignore: raw.ignore,
    git: { maxCommits: raw.git.max_commits, enforceRefs: raw.git.enforce_refs, enforceRefsSince: raw.git.enforce_refs_since },
    triage: {
      autoLinkMinScore: raw.triage.auto_link_min_score,
      autoLinkMargin: raw.triage.auto_link_margin,
      maxCandidates: raw.triage.max_candidates,
      minMatchedTerms: raw.triage.min_matched_terms,
    },
    lifecycle: { grandfathered: raw.lifecycle.grandfathered },
    authoring: {
      draftTtlMinutes: raw.authoring.draft_ttl_minutes,
      maxDrafts: raw.authoring.max_drafts,
      maxDraftBytes: raw.authoring.max_draft_bytes,
    },
  };
}

function parseProjectFileUnsafe(src: string): ProjectFileSettings {
  if (Buffer.byteLength(src, 'utf8') > MAX_PROJECT_FILE_BYTES) throw new Error(`file exceeds ${MAX_PROJECT_FILE_BYTES} bytes`);

  const doc = parseDocument(src, YAML_PARSE_OPTIONS);
  if (doc.errors.length > 0) throw new Error(doc.errors[0]?.message ?? 'parse error');
  if (hasUnresolvedTag(doc)) throw new Error('custom YAML tags are not allowed');
  if (hasAnchorOrAlias(doc)) throw new Error('YAML anchors and aliases are not allowed');

  const root: unknown = doc.toJS(YAML_TO_JS_OPTIONS);
  if (root === null || typeof root !== 'object' || Array.isArray(root)) throw new Error('root must be a mapping');
  assertNoSecretKeys(root);

  const result = rawProjectFileSchema.safeParse(root);
  if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));

  return toSettings(result.data);
}

/** Parses and validates `.prdm.yaml` contents; every failure is wrapped so callers never need to know the source of the error. */
export function parseProjectFile(src: string): ProjectFileSettings {
  try {
    return parseProjectFileUnsafe(src);
  } catch (err) {
    throw new Error(`.prdm.yaml is invalid: ${err instanceof Error ? err.message : String(err)}`);
  }
}

interface RawFolders {
  [kind: string]: string;
}

function toRawFile(settings: ProjectFileSettings): Record<string, unknown> {
  const folders: RawFolders = {};
  for (const kind of DOC_KINDS) folders[kind] = settings.folders[kind];

  return {
    version: 1,
    project: { id: settings.project.id, name: settings.project.name },
    docs_dir: settings.docsDir,
    folders,
    ignore: settings.ignore,
    git: {
      max_commits: settings.git.maxCommits,
      enforce_refs: settings.git.enforceRefs,
      enforce_refs_since: settings.git.enforceRefsSince,
    },
    triage: {
      auto_link_min_score: settings.triage.autoLinkMinScore,
      auto_link_margin: settings.triage.autoLinkMargin,
      max_candidates: settings.triage.maxCandidates,
      min_matched_terms: settings.triage.minMatchedTerms,
    },
    lifecycle: {
      grandfathered: settings.lifecycle.grandfathered.map((doc): GrandfatheredDoc => ({ id: doc.id, hash: doc.hash })),
    },
    authoring: {
      draft_ttl_minutes: settings.authoring.draftTtlMinutes,
      max_drafts: settings.authoring.maxDrafts,
      max_draft_bytes: settings.authoring.maxDraftBytes,
    },
  };
}

/** Deterministic serializer used by `prdm init`/`--adopt`; the output always round-trips through {@link parseProjectFile}. */
export function renderProjectFile(settings: ProjectFileSettings): string {
  return stringify(toRawFile(settings), { schema: 'core', version: '1.2' });
}

/** `prj_` + 16 lowercase hex chars from 8 random bytes (ADR-002 D6); `random` is injectable for deterministic tests. */
export function generateProjectId(random: (size: number) => Buffer = randomBytes): string {
  return `prj_${random(8).toString('hex')}`;
}
