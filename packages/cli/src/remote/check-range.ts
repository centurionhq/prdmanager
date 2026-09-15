/**
 * `prdm check commits --range` in remote mode (SDD-010 "Política Refs:", WO-198): for CI use — fetches
 * policy docs for the *entire* commit range in a single batched request (WO-183's endpoint), each
 * evaluated at that commit's own recorded `first_seen_at` (never "now", never git's own spoofable commit
 * date).
 *
 * Deliberately narrower than local mode's `checkCommitRange`: this evaluates each commit's own `Refs:`
 * trailer against the blueprints/work-orders that governed it *at the time it was first seen*, which is
 * this WO's actual scope — it does not port local mode's aggregate "evil merge" coverage check or
 * `lifecycle.grandfathered`-growth check (both refinements over the core per-commit mechanism, and both
 * meaningless the same way in remote mode: there is no local `.prdm.yaml`/`docs/` history to diff a
 * range's base/head trees against — `grandfathered` and blueprint history both live entirely on the
 * server). A merge commit's `files` comes out empty from `readCommitsInRange` (git's own `--name-only`
 * default for merges), so it is never flagged — the same conservative default local mode uses for a
 * conflict-free merge.
 */
import { evaluateCommit, readCommitsInRange, type EvaluateCommitResult, type RemoteProjectFile } from '@prdm/core';
import { CliError } from '../errors.js';
import { checkProjectPinMismatch, loadCredentials } from './credentials.js';
import { syncGovernanceCache } from './governance-cache.js';
import { scanPolicyDocs } from './policy-doc-scan.js';
import { fetchPolicyDocs } from './policy-docs.js';
import { resolveRemoteServerOrigin } from './server-origin.js';

export interface RemoteCheckRangeEntry {
  sha: string;
  result: EvaluateCommitResult;
}

export interface RemoteCheckRangeResult {
  ok: boolean;
  commits: RemoteCheckRangeEntry[];
}

export interface RemoteCheckRangeDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export async function runRemoteCheckRange(root: string, file: RemoteProjectFile, range: string, deps: RemoteCheckRangeDeps): Promise<RemoteCheckRangeResult> {
  const origin = resolveRemoteServerOrigin(file.remote, deps.env);

  // WO-234/WO-238: `.prdm.yaml`'s `project.id` is repo-tracked — a PR editing only that field would
  // otherwise silently retarget this developer's/CI's range check at a different project. Mirrors the
  // `remote.server` cross-check just above, against the local, non-repo-controlled pin `prdm link`
  // recorded, the same way `sync.ts`/`mcp-proxy.ts` already do.
  const pinMismatch = checkProjectPinMismatch(root, file.project.id, deps.env);
  if (pinMismatch) throw new CliError(pinMismatch);

  const credentials = loadCredentials(deps.env);
  const credential = credentials[origin];
  if (!credential) throw new CliError(`not logged in to ${origin}; run "prdm login --server ${origin}" first`);

  const commits = await readCommitsInRange(root, range);
  if (commits.length === 0) return { ok: true, commits: [] };

  const cache = await syncGovernanceCache(root, origin, file.project.id, credential.token, { fetchImpl: deps.fetchImpl });
  // One request for the whole range (SDD-010: "en un único request"), never one per commit.
  const policyResults = await fetchPolicyDocs(origin, file.project.id, credential.token, commits.map((c) => c.sha), { fetchImpl: deps.fetchImpl });
  const documentsBySha = new Map(policyResults.map((r) => [r.sha, r.documents]));

  const entries: RemoteCheckRangeEntry[] = commits.map((commit) => {
    const policyDocs = scanPolicyDocs(documentsBySha.get(commit.sha) ?? []);
    // `commit.refs` is already the parsed "Refs: WO-xxx" trailer set (readCommitsInRange/parseRefs) —
    // reconstructing a minimal message from it lets `evaluateCommit`'s own `parseRefs` reproduce the
    // exact same set without needing the full raw commit message text.
    const message = commit.refs.length > 0 ? `Refs: ${commit.refs.join(' ')}` : '';
    const result = evaluateCommit({
      changedPaths: commit.files,
      message,
      isMerge: false,
      hasConflictsInGoverned: false,
      docsAtHead: policyDocs,
      docsInIndex: policyDocs,
      settings: { enforceRefs: cache.settings.git.enforceRefs, isWithinEnforcementRange: true },
    });
    return { sha: commit.sha, result };
  });

  return { ok: entries.every((e) => e.result.ok), commits: entries };
}
