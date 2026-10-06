/**
 * `prdm sync` in remote mode (SDD-010 "Sync de developers y drift", WO-195): no local Neo4j at all.
 * `GET .../governance` -> local `scanContents`/`resolveGoverned`/`readCommits`/`dirtyPaths` -> `POST
 * .../code-reports` -> prints the drift the server computed. `--check` exits non-zero on blocking issues.
 */
import { currentBranch, scanContents, type RefreshReport, type RemoteProjectFile } from '@prdm/core';
import type { CodeReportIssueDto, CodeReportResponse } from '@prdm/contracts';
import { CliError } from '../errors.js';
import { formatRefreshReport } from '../format.js';
import { buildCodeReportBody, sendCodeReport, type BlueprintLike } from './code-report.js';
import { checkProjectPinMismatch, resolveRemoteCredential } from './credentials.js';
import { fetchGithubActionsOidcToken } from './github-oidc-token.js';
import { syncGovernanceCache, type GovernanceCacheResult } from './governance-cache.js';
import { resolveRemoteServerOrigin } from './server-origin.js';

export interface RemoteSyncOptions {
  check?: boolean;
  json?: boolean;
}

export interface RemoteSyncDeps {
  stdout: (line: string) => void;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

function blueprintsOf(cache: GovernanceCacheResult): { blueprints: BlueprintLike[]; scanErrors: string[] } {
  const scanned = scanContents(cache.documents.map((d) => ({ path: d.sourcePath, content: d.content })));
  if (scanned.errors.length > 0) return { blueprints: [], scanErrors: scanned.errors.map((e) => `${e.path}: ${e.error}`) };
  const blueprints = scanned.docs.filter((d) => d.node.label === 'Blueprint').map((d) => ({ id: d.node.id, impactsPaths: d.impactsPaths }));
  return { blueprints, scanErrors: [] };
}

async function resolveBranch(root: string, env: NodeJS.ProcessEnv): Promise<string> {
  const local = await currentBranch(root);
  if (local) return local;
  // Detached HEAD (common for CI checkouts of a PR merge commit): GitHub Actions always sets
  // GITHUB_REF_NAME (the branch or tag name that triggered the workflow).
  if (env.GITHUB_REF_NAME) return env.GITHUB_REF_NAME;
  throw new CliError('could not determine the current branch (detached HEAD, and GITHUB_REF_NAME is not set)');
}

function formatIssue(issue: CodeReportIssueDto): string {
  const target = issue.target ? ` -> ${issue.target}` : '';
  const marker = issue.severity === 'error' ? '✗' : '⚠';
  return `  ${marker} ${issue.nodeId}${target}: ${issue.message}`;
}

function formatResponse(response: CodeReportResponse): string {
  const lines = [`mode: ${response.mode}`, `head: ${response.headSha}`];
  if (response.issues.length === 0) lines.push('drift: none');
  else for (const issue of response.issues) lines.push(formatIssue(issue));
  return lines.join('\n');
}

export async function runRemoteSync(root: string, file: RemoteProjectFile, options: RemoteSyncOptions, deps: RemoteSyncDeps): Promise<void> {
  const origin = resolveRemoteServerOrigin(file.remote, deps.env);
  const graphProjectId = file.project.id;

  // WO-234: `.prdm.yaml`'s `project.id` is repo-tracked — a PR editing only that field would otherwise
  // silently retarget this developer's sync run at a different project. Mirrors the `remote.server`
  // cross-check just above, against the local, non-repo-controlled pin `prdm link` recorded.
  const pinMismatch = checkProjectPinMismatch(root, graphProjectId, deps.env);
  if (pinMismatch) throw new CliError(pinMismatch);

  const token = resolveRemoteCredential(origin, deps.env);

  const cacheDeps = { fetchImpl: deps.fetchImpl };
  const cache = await syncGovernanceCache(root, origin, graphProjectId, token, cacheDeps);
  const { blueprints, scanErrors } = blueprintsOf(cache);
  if (scanErrors.length > 0) throw new CliError(`governance cache has invalid document(s): ${scanErrors.join('; ')}`);

  const branch = await resolveBranch(root, deps.env);
  const buildInput = { root, ignore: cache.settings.ignore, gitMaxCommits: cache.settings.git.maxCommits, hashAlgoVersion: cache.hashAlgoVersion };
  const body = await buildCodeReportBody({ ...buildInput, docsGraphVersion: cache.graphVersion, blueprints }, branch);

  const githubOidcToken = await fetchGithubActionsOidcToken(origin, { env: deps.env, fetchImpl: deps.fetchImpl });

  const result = await sendCodeReport(origin, graphProjectId, token, body, buildInput, branch, {
    fetchImpl: deps.fetchImpl,
    githubOidcToken,
    refetch: async () => {
      const refreshedCache = await syncGovernanceCache(root, origin, graphProjectId, token, cacheDeps);
      const refreshed = blueprintsOf(refreshedCache);
      if (refreshed.scanErrors.length > 0) throw new CliError(`governance cache has invalid document(s): ${refreshed.scanErrors.join('; ')}`);
      return { docsGraphVersion: refreshedCache.graphVersion, blueprints: refreshed.blueprints };
    },
  });

  deps.stdout(options.json ? JSON.stringify(result.response, null, 2) : formatResponse(result.response));
  if (options.check && result.response.hasBlockingIssues) throw new CliError('sync check failed: blocking issues found');
}

export interface RemoteAckOptions {
  reason?: string;
}

const MAX_ACK_REASON_LENGTH = 500;

/** SDD-087 D4: `prdm sync ack <target|all> --reason "..."` in remote mode. The reason is checked before
 * anything else (no credential lookup, no `fetch`): the server audits it and rejects a missing one anyway. */
export async function runRemoteAck(root: string, file: RemoteProjectFile, target: string, options: RemoteAckOptions, deps: RemoteSyncDeps): Promise<void> {
  const origin = resolveRemoteServerOrigin(file.remote, deps.env);
  const graphProjectId = file.project.id;

  const reason = options.reason?.trim() ?? '';
  if (reason.length === 0) {
    throw new CliError('--reason is required: "prdm sync ack" records an audited re-baseline; pass --reason "<why this baseline is correct>"');
  }
  if (reason.length > MAX_ACK_REASON_LENGTH) throw new CliError(`--reason must be ${MAX_ACK_REASON_LENGTH} characters or fewer`);

  const pinMismatch = checkProjectPinMismatch(root, graphProjectId, deps.env);
  if (pinMismatch) throw new CliError(pinMismatch);

  const token = resolveRemoteCredential(origin, deps.env);

  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(new URL(`/api/v1/projects/${graphProjectId}/drift/acknowledge`, origin), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ target, reason }),
      redirect: 'error',
    });
  } catch (err) {
    throw new CliError(`could not reach ${origin}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new CliError(`sync ack rejected: ${origin} responded ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const { report } = (await response.json()) as { report: RefreshReport };
  deps.stdout(formatRefreshReport(report));
}
