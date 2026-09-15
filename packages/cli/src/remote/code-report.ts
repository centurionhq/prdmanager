/**
 * Builds and sends a code report from `prdm sync`'s remote mode (SDD-010 "Sync de developers y drift",
 * WO-195): local `scanContents`/`resolveGoverned`/`readCommits`/`dirtyPaths` inputs, packaged exactly to
 * `@prdm/contracts`'s `codeReportRequestSchema`, `POST`ed with a fresh random `Idempotency-Key`. A
 * `409 docs_outdated` triggers exactly one refetch-and-retry — never a loop, and never the *same* key
 * (the retried body has a different `docs_graph_version`/`governed[]`, so reusing the first attempt's key
 * would otherwise 422 as a mismatch, defeating the whole point of retrying).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GITHUB_OIDC_TOKEN_HEADER, type CodeReportRequest, type CodeReportResponse } from '@prdm/contracts';
import { dirtyPaths, readCommits, resolveGoverned, sha256, SymbolCache, type CodeRefState, type CommitInfo } from '@prdm/core';
import { CliError } from '../errors.js';

function readCliVersion(): string {
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const CLI_VERSION = readCliVersion();

export interface BlueprintLike {
  id: string;
  impactsPaths: string[];
}

export interface BuildCodeReportInput {
  root: string;
  ignore: string[];
  gitMaxCommits: number;
  hashAlgoVersion: number;
  docsGraphVersion: string;
  /** Every SDD/ADR document currently in the governance cache. */
  blueprints: readonly BlueprintLike[];
}

function impactsHashOf(paths: readonly string[]): string {
  return sha256(JSON.stringify([...paths].sort()));
}

function toReportedCommit(commit: CommitInfo): CodeReportRequest['commits'][number] {
  // `@prdm/contracts`'s `reportedCommitSchema.date` is `z.iso.datetime()`, which (by default, no
  // `offset: true`) only accepts a `Z`-suffixed UTC instant — `readCommits`'s own `%aI` format is a
  // numeric-offset ISO 8601 string (the committer's local offset), which that schema rejects outright.
  // Normalizing to UTC here is the one place that has to know about the mismatch.
  return { sha: commit.sha, parents: commit.parents, author: commit.author, date: new Date(commit.date).toISOString(), subject: commit.subject, refs: commit.refs, files: commit.files };
}

/** Gathers every local input the request body needs — never computes drift itself (the server does). */
export async function buildCodeReportBody(input: BuildCodeReportInput, branch: string): Promise<CodeReportRequest> {
  const symbolCache = await SymbolCache.load(input.root);
  const governed: CodeReportRequest['governed'] = [];
  const governedWarnings: CodeReportRequest['governed_warnings'] = [];
  const impactsHashes: Record<string, string> = {};

  for (const blueprint of input.blueprints) {
    const { refs, warnings } = await resolveGoverned(input.root, blueprint.impactsPaths, input.ignore, { cache: symbolCache });
    governed.push({ blueprintId: blueprint.id, refs: refs as CodeRefState[] });
    for (const message of warnings) governedWarnings.push({ blueprintId: blueprint.id, message });
    impactsHashes[blueprint.id] = impactsHashOf(blueprint.impactsPaths);
  }
  await symbolCache.saveIfDirty(input.root);

  const commits = await readCommits(input.root, input.gitMaxCommits);
  const headSha = commits[0]?.sha;
  if (!headSha) throw new CliError('could not determine the current commit (HEAD) — is this a git repository with at least one commit?');
  const dirty = [...(await dirtyPaths(input.root))].sort();

  return {
    schema_version: 1,
    client: { prdm_version: CLI_VERSION, hash_algo_version: input.hashAlgoVersion },
    branch,
    head_sha: headSha,
    docs_graph_version: input.docsGraphVersion,
    impacts_hashes: impactsHashes,
    governed,
    governed_warnings: governedWarnings,
    commits: commits.map(toReportedCommit),
    dirty,
  };
}

export interface SendCodeReportDeps {
  fetchImpl?: typeof fetch;
  /** The GitHub Actions OIDC token to attach, when running in CI with `id-token: write` (WO-195: "en CI
   * se adjunta el OIDC token de GitHub Actions"). `undefined` outside CI. */
  githubOidcToken?: string;
  /** Refetches governance and rebuilds the body against the new `graph_version` — the one-and-only
   * retry a `409 docs_outdated` triggers. */
  refetch: () => Promise<{ docsGraphVersion: string; blueprints: readonly BlueprintLike[] }>;
}

export interface SendCodeReportResult {
  response: CodeReportResponse;
  /** How many times the request was actually sent (1, or 2 after exactly one `docs_outdated` retry). */
  attempts: number;
}

async function postOnce(origin: string, graphProjectId: string, token: string, body: CodeReportRequest, deps: SendCodeReportDeps): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    // Fresh per POST (see the module doc comment) — never reused across the docs_outdated retry, whose
    // body necessarily differs.
    'idempotency-key': randomUUID(),
  };
  if (deps.githubOidcToken) headers[GITHUB_OIDC_TOKEN_HEADER] = deps.githubOidcToken;

  return fetchImpl(new URL(`/api/v1/projects/${graphProjectId}/code-reports`, origin), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'error',
  });
}

/** Sends `body`; on `409 docs_outdated`, refetches (via `deps.refetch`) and resends exactly once with a
 * rebuilt body — never loops further. */
export async function sendCodeReport(
  origin: string,
  graphProjectId: string,
  token: string,
  body: CodeReportRequest,
  buildInput: Omit<BuildCodeReportInput, 'docsGraphVersion' | 'blueprints'>,
  branch: string,
  deps: SendCodeReportDeps,
): Promise<SendCodeReportResult> {
  let response: Response;
  try {
    response = await postOnce(origin, graphProjectId, token, body, deps);
  } catch (err) {
    throw new CliError(`could not reach ${origin}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 409) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    if (errorBody?.error === 'docs_outdated') {
      const refreshed = await deps.refetch();
      const retryBody = await buildCodeReportBody({ ...buildInput, docsGraphVersion: refreshed.docsGraphVersion, blueprints: refreshed.blueprints }, branch);
      let retryResponse: Response;
      try {
        retryResponse = await postOnce(origin, graphProjectId, token, retryBody, deps);
      } catch (err) {
        throw new CliError(`could not reach ${origin}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { response: await parseCodeReportResponse(origin, retryResponse), attempts: 2 };
    }
  }

  return { response: await parseCodeReportResponse(origin, response), attempts: 1 };
}

async function parseCodeReportResponse(origin: string, response: Response): Promise<CodeReportResponse> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new CliError(`code report rejected: ${origin} responded ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await response.json()) as CodeReportResponse;
}

