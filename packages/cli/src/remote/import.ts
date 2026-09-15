/**
 * `prdm link --import` (SDD-010 "Importador", WO-194): reads `docs/`, `.prdm.yaml` and
 * `.prdm/baseline.json` from the local repository, validates them client-side with `@prdm/core` (fast
 * feedback — WO-192's endpoint re-validates everything server-side regardless, this is purely a courtesy
 * that catches an obviously-broken repo before a network round trip), uploads them to
 * `POST /api/v1/projects/:graphProjectId/import`, and prints a summary.
 */
import { BASELINE_PATH, parseProjectFile, safeReadFile, scanDocuments } from '@prdm/core';
import { MAX_IMPORT_BODY_BYTES, MAX_IMPORT_DOCUMENTS } from '@prdm/contracts';
import { CliError, messageOf } from '../errors.js';

export interface ImportTarget {
  /** Origin only (e.g. `https://app.example.com`) — never a full URL with a path. */
  server: string;
  graphProjectId: string;
  token: string;
}

export interface ImportIoDeps {
  stdout: (line: string) => void;
  fetchImpl?: typeof fetch;
}

interface ImportResponseBody {
  imported: number;
  documents: { id: string; sourcePath: string }[];
}

export interface LocalImportPayload {
  prdmYaml: string;
  documents: { sourcePath: string; content: string }[];
  baselineJson?: string;
}

async function readLocalDocuments(root: string, ignore: string[]): Promise<{ sourcePath: string; content: string }[]> {
  const scan = await scanDocuments(root, ignore);
  if (scan.errors.length > 0) {
    throw new CliError(`fix ${scan.errors.length} invalid document(s) before importing (run "prdm lint"): ${scan.errors.map((e) => `${e.path}: ${e.error}`).join('; ')}`);
  }
  const documents: { sourcePath: string; content: string }[] = [];
  for (const doc of scan.docs) {
    const raw = await safeReadFile(root, doc.node.sourcePath);
    if (raw === null) throw new CliError(`could not re-read ${doc.node.sourcePath}`);
    documents.push({ sourcePath: doc.node.sourcePath, content: raw });
  }
  if (documents.length > MAX_IMPORT_DOCUMENTS) {
    throw new CliError(`this repository has ${documents.length} documents, more than the ${MAX_IMPORT_DOCUMENTS} import limit`);
  }
  return documents;
}

/** Reads and client-side-validates everything `prdm link --import` uploads, without making any network
 * call yet — exported separately so the round-trip test can exercise exactly this step. */
export async function readLocalImportPayload(root: string): Promise<LocalImportPayload> {
  const prdmYaml = await safeReadFile(root, '.prdm.yaml');
  if (prdmYaml === null) throw new CliError('.prdm.yaml not found; this repository has no local project to import');

  let settings: ReturnType<typeof parseProjectFile>;
  try {
    settings = parseProjectFile(prdmYaml);
  } catch (err) {
    throw new CliError(`local .prdm.yaml is invalid: ${messageOf(err)}`);
  }

  const documents = await readLocalDocuments(root, settings.ignore);
  const baselineJson = (await safeReadFile(root, BASELINE_PATH)) ?? undefined;

  const bodyBytes = Buffer.byteLength(prdmYaml, 'utf8') + documents.reduce((sum, d) => sum + Buffer.byteLength(d.content, 'utf8'), 0) + (baselineJson ? Buffer.byteLength(baselineJson, 'utf8') : 0);
  if (bodyBytes > MAX_IMPORT_BODY_BYTES) {
    throw new CliError(`this repository's docs (${bodyBytes} bytes) exceed the ${MAX_IMPORT_BODY_BYTES}-byte import limit`);
  }

  return { prdmYaml, documents, baselineJson };
}

/** Uploads an already-read-and-validated local payload (SDD-010, WO-194) — split from `runImport` so
 * `prdm link --import` can read the payload *before* `planLink`/`applyLink` overwrite `.prdm.yaml` with
 * the `version: 2` remote file, and only upload afterward. */
export async function uploadImportPayload(payload: LocalImportPayload, target: ImportTarget, deps: ImportIoDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(new URL(`/api/v1/projects/${target.graphProjectId}/import`, target.server), {
      method: 'POST',
      headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ schema_version: 1, ...payload }),
      redirect: 'error',
    });
  } catch (err) {
    throw new CliError(`could not reach ${target.server}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new CliError(`import failed: ${target.server} responded ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const body = (await response.json()) as ImportResponseBody;
  deps.stdout(`imported ${body.imported} document(s) into ${target.graphProjectId}`);
  for (const doc of body.documents) deps.stdout(`  ${doc.id}  ${doc.sourcePath}`);
}

/** Reads, validates and uploads in one call — the shape `prdm link --import` uses when there is no
 * `.prdm.yaml` rewrite to sequence around (kept for any future standalone caller/test). */
export async function runImport(root: string, target: ImportTarget, deps: ImportIoDeps): Promise<void> {
  const payload = await readLocalImportPayload(root);
  await uploadImportPayload(payload, target, deps);
}
