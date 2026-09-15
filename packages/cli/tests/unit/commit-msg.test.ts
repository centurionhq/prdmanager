/**
 * `runRemoteCommitMsg` (SDD-010 "Política Refs:", WO-197): uses the WO-195 governance cache instead of
 * local git blobs, refetches once when the cache is stale, falls back to the stale cache with a warning
 * when that refetch fails, and applies `offline_policy` when there's no cache at all.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderRemoteProjectFile, type RemoteProjectFile } from '@prdm/core';
import { commitAll, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { saveCredentials } from '../../src/remote/credentials.js';
import { REFETCH_TIMEOUT_MS, runRemoteCommitMsg, STALE_CACHE_THRESHOLD_MS } from '../../src/remote/commit-msg.js';
import { syncGovernanceCache } from '../../src/remote/governance-cache.js';

const SETTINGS = { folders: {}, ignore: [], git: { max_commits: 500, enforce_refs: true, enforce_refs_since: null }, triage: {}, lifecycle: {}, default_branch: 'main', github_repository: null, github_repository_id: null, github_owner_id: null, hash_algo_version: 1 };
const WO_DOC = '---\nid: WO-001\ntype: WO\ntitle: "Work"\nstatus: pending\nimplements: ["SDD-001"]\n---\nBody.\n';
const SDD_DOC = '---\nid: SDD-001\ntype: SDD\ntitle: "Blueprint"\narchitects: ["PRD-001"]\nimpacts_paths: ["src/**"]\n---\nBody.\n';

function remoteFile(server: string, offlinePolicy: 'warn' | 'block' = 'warn'): RemoteProjectFile {
  return { version: 2, project: { id: 'prj_0123456789abcdef', name: 'x' }, remote: { server, org: 'acme', project: 'x', offlinePolicy } };
}

function governanceFetch(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        graphVersion: '1',
        settings: SETTINGS,
        documents: [
          { id: 'SDD-001', sourcePath: 'docs/sdd/SDD-001.md', content: SDD_DOC },
          { id: 'WO-001', sourcePath: 'docs/work-orders/WO-001.md', content: WO_DOC },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;
}

function setManifestFetchedAt(root: string, isoDate: string): void {
  const path = join(root, '.prdm/remote/manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  manifest.fetchedAt = isoDate;
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

let root: string;
let xdgHome: string;

beforeEach(() => {
  root = makeTmpDir('prdm-commit-msg-');
  xdgHome = makeTmpDir('prdm-commit-msg-xdg-');
  writeFiles(root, { 'src/foo.ts': 'export const x = 1;\n' });
  gitInit(root);
  commitAll(root, 'chore: init');
  writeFiles(root, { 'src/foo.ts': 'export const x = 2;\n' });
});

afterEach(() => {
  removeDir(root);
  removeDir(xdgHome);
});

async function stageAll(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['add', '-A'], { cwd: root });
}

describe('runRemoteCommitMsg (WO-197)', () => {
  test('no cache at all, offlinePolicy warn: passes with a warning', async () => {
    await stageAll();
    const { result, warning } = await runRemoteCommitMsg(root, remoteFile('https://app.example.test', 'warn'), 'chore: x', {}, { env: {} });
    expect(result.ok).toBe(true);
    expect(warning).toMatch(/no local governance cache/);
  });

  test('no cache at all, offlinePolicy block: fails clearly', async () => {
    await stageAll();
    const { result } = await runRemoteCommitMsg(root, remoteFile('https://app.example.test', 'block'), 'chore: x', {}, { env: {} });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/offline_policy is "block"/);
  });

  test('fresh cache: evaluates against it without attempting a refetch', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl: governanceFetch() });
    await stageAll();

    let refetchCalled = false;
    const fetchImpl = (async () => {
      refetchCalled = true;
      throw new Error('should not be called');
    }) as typeof fetch;

    const { result, warning } = await runRemoteCommitMsg(root, remoteFile('https://app.example.test'), 'chore: touch foo', {}, { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });
    expect(refetchCalled).toBe(false);
    expect(warning).toBeUndefined();
    expect(result.ok).toBe(false); // no Refs: trailer yet
    expect(result.requiredFor).toEqual(['src/foo.ts']);

    const withRefs = await runRemoteCommitMsg(root, remoteFile('https://app.example.test'), 'chore: touch foo\n\nRefs: WO-001', {}, { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });
    expect(withRefs.result.ok).toBe(true);
  });

  test('stale cache, successful refetch: uses the refreshed docs, no warning', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl: governanceFetch() });
    setManifestFetchedAt(root, new Date(Date.now() - STALE_CACHE_THRESHOLD_MS - 1000).toISOString());
    await stageAll();

    let refetchCalled = false;
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      refetchCalled = true;
      return governanceFetch()(...args);
    }) as typeof fetch;

    const { result, warning } = await runRemoteCommitMsg(
      root,
      remoteFile('https://app.example.test'),
      'chore: touch foo\n\nRefs: WO-001',
      {},
      { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl },
    );
    expect(refetchCalled).toBe(true);
    expect(warning).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  test('stale cache, refetch fails: falls back to the stale cache with a warning', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl: governanceFetch() });
    setManifestFetchedAt(root, new Date(Date.now() - STALE_CACHE_THRESHOLD_MS - 1000).toISOString());
    await stageAll();

    const fetchImpl = (async () => {
      throw new Error('network unreachable');
    }) as typeof fetch;

    const { result, warning } = await runRemoteCommitMsg(
      root,
      remoteFile('https://app.example.test'),
      'chore: touch foo\n\nRefs: WO-001',
      {},
      { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl },
    );
    expect(warning).toMatch(/possibly-stale policy/);
    // The stale cache still has WO-001 governing src/**, so the commit still passes.
    expect(result.ok).toBe(true);
  }, REFETCH_TIMEOUT_MS + 10_000);
});
