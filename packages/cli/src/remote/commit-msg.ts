/**
 * `commit-msg` hook in remote mode (SDD-010 "Política Refs:", WO-197): uses the WO-195 governance cache
 * rather than local git blobs for policy *documents* (there is nothing to `git show` — published docs
 * live on the server). If the cache is older than 10 minutes, attempts one short-timeout refetch first;
 * if that fails (genuinely offline), evaluates against whatever's cached with a visible "using
 * possibly-stale policy" warning; with no cache at all, falls back to `.prdm.yaml`'s own
 * `remote.offline_policy` (`warn`/`block`).
 */
import { checkCommitMessage, scanContents, type CommitMsgCheckOptions, type EvaluateCommitResult, type PolicyDoc, type RemoteProjectFile, type WorkOrderStatus } from '@prdm/core';
import { CliError } from '../errors.js';
import { loadCredentials } from './credentials.js';
import { loadCachedGovernance, syncGovernanceCache, type GovernanceCacheResult } from './governance-cache.js';
import { resolveRemoteServerOrigin } from './server-origin.js';

/** Cached governance older than this triggers a refetch attempt before evaluating (SDD-010, WO-197). */
export const STALE_CACHE_THRESHOLD_MS = 10 * 60 * 1000;
/** How long the refetch attempt itself is allowed to take before falling back to the stale cache. */
export const REFETCH_TIMEOUT_MS = 5_000;

export interface RemoteCommitMsgDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface RemoteCommitMsgResult {
  result: EvaluateCommitResult;
  /** Set when this evaluation used a stale cache after a failed refetch, or (message only, `result.ok`
   * always `true` in that case) when there was no cache at all and `offline_policy` is `warn`. */
  warning?: string;
}

function blueprintOrWorkOrderDocs(cache: Pick<GovernanceCacheResult, 'documents'>): PolicyDoc[] {
  const scanned = scanContents(cache.documents.map((d) => ({ path: d.sourcePath, content: d.content })));
  const docs: PolicyDoc[] = [];
  for (const doc of scanned.docs) {
    if (doc.node.kind === 'SDD' || doc.node.kind === 'ADR') docs.push({ type: doc.node.kind, id: doc.node.id, impactsPaths: doc.impactsPaths });
    else if (doc.node.kind === 'WO') docs.push({ type: 'WO', id: doc.node.id, status: doc.node.status as WorkOrderStatus, implements: (doc.frontmatter as { implements: string[] }).implements });
  }
  return docs;
}

/** A `PolicyDocsSource` over an already-resolved, fixed document set — remote governance has no ref
 * history, so every `ref` ('HEAD'/'INDEX') sees the exact same cached snapshot. */
function staticSource(docs: readonly PolicyDoc[]) {
  return {
    async policyDocsAt(): Promise<PolicyDoc[]> {
      return [...docs];
    },
    async nestedProjectRootsAt(): Promise<string[]> {
      return [];
    },
    async settingsAt() {
      return null;
    },
  };
}

async function attemptRefetch(root: string, origin: string, graphProjectId: string, token: string, deps: RemoteCommitMsgDeps): Promise<GovernanceCacheResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REFETCH_TIMEOUT_MS);
  const baseFetch = deps.fetchImpl ?? fetch;
  try {
    return await syncGovernanceCache(root, origin, graphProjectId, token, {
      fetchImpl: (input, init) => baseFetch(input, { ...init, signal: controller.signal }),
      now: deps.now,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runRemoteCommitMsg(root: string, file: RemoteProjectFile, message: string, options: CommitMsgCheckOptions, deps: RemoteCommitMsgDeps): Promise<RemoteCommitMsgResult> {
  const now = deps.now ?? (() => new Date());
  const cached = await loadCachedGovernance(root);

  if (!cached) {
    if (file.remote.offlinePolicy === 'block') {
      return {
        result: { ok: false, requiredFor: [], refs: [], message: 'no local governance cache and offline_policy is "block"; run "prdm sync" first' },
      };
    }
    return { result: { ok: true, requiredFor: [], refs: [] }, warning: 'no local governance cache; commit policy could not be checked (offline_policy: warn)' };
  }

  let effective: GovernanceCacheResult = cached;
  let warning: string | undefined;

  const isStale = cached.ageMs === null || cached.ageMs > STALE_CACHE_THRESHOLD_MS;
  if (isStale) {
    const origin = resolveRemoteServerOrigin(file.remote, deps.env);
    const credentials = loadCredentials(deps.env);
    const credential = credentials[origin];
    if (!credential) throw new CliError(`not logged in to ${origin}; run "prdm login --server ${origin}" first`);

    const refreshed = await attemptRefetch(root, origin, file.project.id, credential.token, deps);
    if (refreshed) {
      effective = refreshed;
    } else {
      warning = 'using possibly-stale policy: the governance cache is more than 10 minutes old and could not be refreshed (offline?)';
    }
  }

  const docs = blueprintOrWorkOrderDocs(effective);
  const remoteSettings = { enforceRefs: effective.settings.git.enforceRefs, ignore: effective.settings.ignore };
  const result = await checkCommitMessage(root, message, options, staticSource(docs), remoteSettings);
  return warning ? { result, warning } : { result };
}
