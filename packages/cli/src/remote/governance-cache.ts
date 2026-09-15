/**
 * `prdm sync`'s remote-mode governance cache (SDD-010 "Sync de developers y drift", WO-195): `GET
 * .../governance` with `If-None-Match`, written *only* under `.prdm/remote/` via `safeReplaceAtomic`
 * (never anywhere the server's response could otherwise point at). Every `<ID>.md` is validated against
 * the exact same `ID_PATTERN` `@prdm/core` uses everywhere else *before* it's ever used to build a path —
 * the server is nominally trusted (SDD-010's own threat model), but this is defense in depth: an id is
 * never blindly trusted to be safe just because it *should* already be scope-restricted by the contract
 * schema upstream.
 */
import { governanceResponseSchema, type GovernanceDocumentDto, type GovernanceResponseDto } from '@prdm/contracts';
import { ID_PATTERN, parseGovernedSettings, safeReadFile, safeReplaceAtomic, safeUnlink, type GovernedSettings } from '@prdm/core';
import { CliError } from '../errors.js';

export const GOVERNANCE_CACHE_DIR = '.prdm/remote';
const DOCS_SUBDIR = `${GOVERNANCE_CACHE_DIR}/docs`;
const MANIFEST_PATH = `${GOVERNANCE_CACHE_DIR}/manifest.json`;

interface GovernanceManifest {
  graphVersion: string;
  ids: string[];
  /** ISO timestamp of the last successful fetch (WO-197: the `commit-msg` hook's "cache older than 10
   * minutes" check reads this). Absent from a manifest written before WO-197 — treated as "unknown age"
   * (as stale as possible) rather than crashing. */
  fetchedAt?: string;
}

export interface GovernanceCacheDeps {
  fetchImpl?: typeof fetch;
  /** Injectable so a test can prove a planted symlink is rejected without reaching into `safe-fs`
   * internals — defaults to the real, hardened `safeReplaceAtomic`. */
  writeFile?: (root: string, relPath: string, content: string) => Promise<void>;
  /** Injectable clock (WO-197), recorded into the manifest as `fetchedAt`. */
  now?: () => Date;
}

export interface CachedGovernanceDocument {
  id: string;
  sourcePath: string;
  content: string;
}

export interface GovernanceCacheResult {
  graphVersion: string;
  settings: GovernedSettings;
  /** Not part of `GovernedSettings` (that type only covers the fields `.prdm.yaml` itself has); the code
   * report's own `client.hash_algo_version` needs the server's raw value directly. */
  hashAlgoVersion: number;
  documents: CachedGovernanceDocument[];
  /** `true` when the server answered `304` (nothing changed since the last sync). */
  unchanged: boolean;
}

function docCachePath(id: string): string {
  return `${DOCS_SUBDIR}/${id}.md`;
}

async function readManifest(root: string): Promise<GovernanceManifest | null> {
  const raw = await safeReadFile(root, MANIFEST_PATH);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { graphVersion, ids, fetchedAt } = parsed as Partial<GovernanceManifest>;
    if (typeof graphVersion !== 'string' || !Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
    return { graphVersion, ids, fetchedAt: typeof fetchedAt === 'string' ? fetchedAt : undefined };
  } catch {
    return null;
  }
}

/** Validates `doc.id` against `ID_PATTERN` *before* it's ever used to build `docCachePath` — see the
 * module doc comment. Throws rather than silently skipping: a server response naming an unsafe id is
 * treated as a hard failure, not a partially-applied sync. */
function assertSafeGovernanceDocId(doc: GovernanceDocumentDto): void {
  if (!ID_PATTERN.test(doc.id)) {
    throw new CliError(`refusing to cache a governance document with an unsafe id: ${JSON.stringify(doc.id)}`);
  }
}

async function loadCachedDocuments(root: string, ids: readonly string[], readFile: (root: string, relPath: string) => Promise<string | null>): Promise<CachedGovernanceDocument[]> {
  const documents: CachedGovernanceDocument[] = [];
  for (const id of ids) {
    const content = await readFile(root, docCachePath(id));
    if (content === null) throw new CliError(`governance cache is inconsistent: ${docCachePath(id)} is missing; delete .prdm/remote and re-run "prdm sync"`);
    documents.push({ id, sourcePath: docCachePath(id), content });
  }
  return documents;
}

async function writeGovernanceResponse(
  root: string,
  response: GovernanceResponseDto,
  deps: Required<Pick<GovernanceCacheDeps, 'writeFile'>> & { now: () => Date },
): Promise<CachedGovernanceDocument[]> {
  for (const doc of response.documents) assertSafeGovernanceDocId(doc);

  const existing = await readManifest(root);
  const nextIds = new Set(response.documents.map((d) => d.id));
  for (const staleId of existing?.ids ?? []) {
    if (!nextIds.has(staleId)) await safeUnlink(root, docCachePath(staleId));
  }

  const documents: CachedGovernanceDocument[] = [];
  for (const doc of response.documents) {
    const path = docCachePath(doc.id);
    await deps.writeFile(root, path, doc.content);
    documents.push({ id: doc.id, sourcePath: path, content: doc.content });
  }

  const manifest: GovernanceManifest = { graphVersion: response.graphVersion, ids: [...nextIds], fetchedAt: deps.now().toISOString() };
  await deps.writeFile(root, MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return documents;
}

/**
 * Fetches governance, using the cached `graphVersion` as `If-None-Match`. On `304`, reuses the cached
 * documents/settings unchanged; on `200`, rewrites the cache (pruning stale ids) and returns the new
 * state. Never writes anywhere outside `.prdm/remote/`.
 */
export async function syncGovernanceCache(root: string, origin: string, graphProjectId: string, token: string, deps: GovernanceCacheDeps = {}): Promise<GovernanceCacheResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const manifest = await readManifest(root);

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (manifest) headers['if-none-match'] = `"${manifest.graphVersion}"`;

  let response: Response;
  try {
    response = await fetchImpl(new URL(`/api/v1/projects/${graphProjectId}/governance`, origin), { method: 'GET', headers, redirect: 'error' });
  } catch (err) {
    throw new CliError(`could not reach ${origin}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 304) {
    if (!manifest) throw new CliError(`${origin} answered 304 Not Modified with no local governance cache to reuse`);
    const settingsRaw = await safeReadFile(root, `${GOVERNANCE_CACHE_DIR}/settings.json`);
    if (settingsRaw === null) throw new CliError('governance cache is inconsistent: settings.json is missing; delete .prdm/remote and re-run "prdm sync"');
    const documents = await loadCachedDocuments(root, manifest.ids, safeReadFile);
    const rawSettings = JSON.parse(settingsRaw) as { hash_algo_version?: unknown };
    const hashAlgoVersion = typeof rawSettings.hash_algo_version === 'number' ? rawSettings.hash_algo_version : 1;
    return { graphVersion: manifest.graphVersion, settings: parseGovernedSettings(rawSettings), hashAlgoVersion, documents, unchanged: true };
  }

  if (!response.ok) throw new CliError(`could not fetch governance from ${origin}: responded ${response.status}`);

  const parsed = governanceResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new CliError(`${origin} returned an invalid governance response`);
  const body = parsed.data;

  const settings = parseGovernedSettings(body.settings);
  const documents = await writeGovernanceResponse(root, body, { writeFile, now: deps.now ?? (() => new Date()) });
  await writeFile(root, `${GOVERNANCE_CACHE_DIR}/settings.json`, JSON.stringify(body.settings, null, 2));

  return { graphVersion: body.graphVersion, settings, hashAlgoVersion: body.settings.hash_algo_version, documents, unchanged: false };
}

async function defaultWriteFile(root: string, relPath: string, content: string): Promise<void> {
  await safeReplaceAtomic(root, relPath, content);
}

/** Reads whatever governance is currently cached, without ever making a network call — the `commit-msg`
 * hook's (WO-197) offline fallback. `null` when there is no cache at all. */
export async function loadCachedGovernance(root: string): Promise<(GovernanceCacheResult & { ageMs: number | null }) | null> {
  const manifest = await readManifest(root);
  if (!manifest) return null;
  const settingsRaw = await safeReadFile(root, `${GOVERNANCE_CACHE_DIR}/settings.json`);
  if (settingsRaw === null) return null;
  const documents = await loadCachedDocuments(root, manifest.ids, safeReadFile);
  const rawSettings = JSON.parse(settingsRaw) as { hash_algo_version?: unknown };
  const hashAlgoVersion = typeof rawSettings.hash_algo_version === 'number' ? rawSettings.hash_algo_version : 1;
  const ageMs = manifest.fetchedAt ? Date.now() - new Date(manifest.fetchedAt).getTime() : null;
  return { graphVersion: manifest.graphVersion, settings: parseGovernedSettings(rawSettings), hashAlgoVersion, documents, unchanged: true, ageMs };
}
