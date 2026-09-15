/**
 * `runRemoteCheckRange` (SDD-010 "Política Refs:", WO-198): fetches policy docs for a whole commit range
 * in a single batched request, evaluated per commit against the documents that request returned for it
 * (standing in for "at that sha's first_seen_at", which is the server's own job to resolve).
 */
import { renderRemoteProjectFile, type RemoteProjectFile } from '@prdm/core';
import { commitAll, gitInit, makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runRemoteCheckRange } from '../../src/remote/check-range.js';
import { saveCredentials, saveProjectPin } from '../../src/remote/credentials.js';

const SETTINGS = { folders: {}, ignore: [], git: { max_commits: 500, enforce_refs: true, enforce_refs_since: null }, triage: {}, lifecycle: {}, default_branch: 'main', github_repository: null, github_repository_id: null, github_owner_id: null, hash_algo_version: 1 };
const SDD_DOC = '---\nid: SDD-001\ntype: SDD\ntitle: "Blueprint"\narchitects: ["PRD-001"]\nimpacts_paths: ["src/**"]\n---\nBody.\n';
const WO_DOC = '---\nid: WO-001\ntype: WO\ntitle: "Work"\nstatus: pending\nimplements: ["SDD-001"]\n---\nBody.\n';
const GOVERNANCE_DOCS = [
  { id: 'SDD-001', sourcePath: 'docs/sdd/SDD-001.md', content: SDD_DOC },
  { id: 'WO-001', sourcePath: 'docs/work-orders/WO-001.md', content: WO_DOC },
];

function remoteFile(server: string): RemoteProjectFile {
  return { version: 2, project: { id: 'prj_0123456789abcdef', name: 'x' }, remote: { server, org: 'acme', project: 'x', offlinePolicy: 'warn' } };
}

let root: string;
let xdgHome: string;

beforeEach(() => {
  root = makeTmpDir('prdm-check-range-');
  xdgHome = makeTmpDir('prdm-check-range-xdg-');
  saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
  saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef' }, { XDG_CONFIG_HOME: xdgHome });
});

afterEach(() => {
  removeDir(root);
  removeDir(xdgHome);
});

function fakeFetch(policyDocsBySha: Record<string, typeof GOVERNANCE_DOCS>): typeof fetch {
  return (async (url) => {
    const path = new URL(url as string | URL).pathname;
    if (path.endsWith('/governance')) return new Response(JSON.stringify({ graphVersion: '1', settings: SETTINGS, documents: [] }), { status: 200 });
    if (path.endsWith('/policy-docs')) {
      const results = Object.entries(policyDocsBySha).map(([sha, documents]) => ({ sha, evaluatedAt: new Date().toISOString(), documents }));
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('runRemoteCheckRange (WO-198)', () => {
  test('a commit with a valid Refs: trailer for the governing sha\'s own policy docs passes', async () => {
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'a' });
    const base = commitAll(root, 'chore: init');
    writeFiles(root, { 'src/a.ts': 'a2' });
    const head = commitAll(root, 'feat: touch a\n\nRefs: WO-001');

    const fetchImpl = fakeFetch({ [head]: GOVERNANCE_DOCS });
    const check = await runRemoteCheckRange(root, remoteFile('https://app.example.test'), `${base}..${head}`, { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });

    expect(check.ok).toBe(true);
    expect(check.commits).toEqual([{ sha: head, result: expect.objectContaining({ ok: true }) }]);
  });

  test('a commit missing the Refs: trailer for its own governing policy docs fails', async () => {
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'a' });
    const base = commitAll(root, 'chore: init');
    writeFiles(root, { 'src/a.ts': 'a2' });
    const head = commitAll(root, 'feat: touch a without refs');

    const fetchImpl = fakeFetch({ [head]: GOVERNANCE_DOCS });
    const check = await runRemoteCheckRange(root, remoteFile('https://app.example.test'), `${base}..${head}`, { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });

    expect(check.ok).toBe(false);
    expect(check.commits[0]!.result.ok).toBe(false);
  });

  test('two different commits get their own (potentially different) policy docs from the batched response', async () => {
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'a' });
    const base = commitAll(root, 'chore: init');
    writeFiles(root, { 'src/a.ts': 'a2' });
    const middle = commitAll(root, 'feat: touch a\n\nRefs: WO-001');
    writeFiles(root, { 'src/a.ts': 'a3' });
    const head = commitAll(root, 'feat: touch a again, no refs since WO-001 is now closed');

    // The second commit's own snapshot shows WO-001 already done (closed) — its own Refs: cannot validate it.
    const closedWo = '---\nid: WO-001\ntype: WO\ntitle: "Work"\nstatus: done\nimplements: ["SDD-001"]\n---\nBody.\n';
    const fetchImpl = fakeFetch({
      [middle]: GOVERNANCE_DOCS,
      [head]: [GOVERNANCE_DOCS[0]!, { id: 'WO-001', sourcePath: 'docs/work-orders/WO-001.md', content: closedWo }],
    });

    const check = await runRemoteCheckRange(root, remoteFile('https://app.example.test'), `${base}..${head}`, { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });
    expect(check.ok).toBe(false);
    expect(check.commits.map((c) => [c.sha, c.result.ok])).toEqual([
      [middle, true],
      [head, false],
    ]);
  });

  test('an empty range reports ok with no commits', async () => {
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'a' });
    const sha = commitAll(root, 'chore: init');
    const fetchImpl = fakeFetch({});
    const check = await runRemoteCheckRange(root, remoteFile('https://app.example.test'), `${sha}..${sha}`, { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });
    expect(check).toEqual({ ok: true, commits: [] });
  });

  test('.prdm.yaml project.id disagrees with the local pin: refuses without ever fetching (WO-238)', async () => {
    gitInit(root);
    writeFiles(root, { 'src/a.ts': 'a' });
    const sha = commitAll(root, 'chore: init');
    // Simulates a PR that edited only .prdm.yaml's project.id after this repo was already linked.
    saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_fedcba9876543210' }, { XDG_CONFIG_HOME: xdgHome });

    let fetchCalled = false;
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      return fakeFetch({})(...args);
    }) as typeof fetch;

    await expect(runRemoteCheckRange(root, remoteFile('https://app.example.test'), `${sha}..${sha}`, { env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl })).rejects.toThrow(/project.id/);
    expect(fetchCalled).toBe(false);
  });
});
