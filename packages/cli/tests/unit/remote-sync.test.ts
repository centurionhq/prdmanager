/**
 * `runRemoteSync` (SDD-010 "Sync de developers y drift", WO-195): wires governance-cache + code-report
 * together against a fake server, and exercises `--check`'s exit behavior without depending on how the
 * server itself derives `hasBlockingIssues` (already covered by the first half's code-reports tests).
 */
import { execFileSync } from 'node:child_process';
import { renderRemoteProjectFile, type RemoteProjectFile } from '@prdm/core';
import { createFixtureRepo, makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { saveCredentials } from '../../src/remote/credentials.js';
import { runRemoteSync } from '../../src/remote/sync.js';

const SETTINGS = { folders: {}, ignore: [], git: {}, triage: {}, lifecycle: {}, default_branch: 'main', github_repository: null, github_repository_id: null, github_owner_id: null, hash_algo_version: 1 };

function remoteFile(server: string): RemoteProjectFile {
  return { version: 2, project: { id: 'prj_0123456789abcdef', name: 'x' }, remote: { server, org: 'acme', project: 'x', offlinePolicy: 'warn' } };
}

function fakeServer(codeReportStatus: number, codeReportBody: unknown): typeof fetch {
  return (async (url) => {
    const path = new URL(url as string | URL).pathname;
    if (path.endsWith('/governance')) {
      return new Response(JSON.stringify({ graphVersion: '1', settings: SETTINGS, documents: [] }), { status: 200 });
    }
    if (path.endsWith('/code-reports')) {
      return new Response(JSON.stringify(codeReportBody), { status: codeReportStatus });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

let root: string;
let xdgHome: string;

beforeEach(() => {
  root = createFixtureRepo();
  xdgHome = makeTmpDir('prdm-remote-sync-xdg-');
});

afterEach(() => {
  removeDir(root);
  removeDir(xdgHome);
});

describe('runRemoteSync (WO-195)', () => {
  test('prints the drift and does not throw when there are no blocking issues', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    const lines: string[] = [];
    const fetchImpl = fakeServer(200, { mode: 'preview', reportId: 'r1', headSha: 'a'.repeat(40), issues: [], hasBlockingIssues: false });

    await runRemoteSync(root, remoteFile('https://app.example.test'), { check: true }, { stdout: (l) => lines.push(l), env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });

    expect(lines.some((l) => l.includes('mode: preview'))).toBe(true);
    expect(lines.some((l) => l.includes('drift: none'))).toBe(true);
  });

  test('--check throws when the server reports blocking issues', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    const fetchImpl = fakeServer(200, {
      mode: 'preview',
      reportId: 'r1',
      headSha: 'a'.repeat(40),
      issues: [{ kind: 'missing', severity: 'error', nodeId: 'SDD-001', message: 'boom' }],
      hasBlockingIssues: true,
    });

    await expect(runRemoteSync(root, remoteFile('https://app.example.test'), { check: true }, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl })).rejects.toThrow(
      CliError,
    );
  });

  test('without --check, blocking issues are printed but do not throw', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    const lines: string[] = [];
    const fetchImpl = fakeServer(200, {
      mode: 'preview',
      reportId: 'r1',
      headSha: 'a'.repeat(40),
      issues: [{ kind: 'missing', severity: 'error', nodeId: 'SDD-001', message: 'boom' }],
      hasBlockingIssues: true,
    });

    await runRemoteSync(root, remoteFile('https://app.example.test'), {}, { stdout: (l) => lines.push(l), env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });
    expect(lines.some((l) => l.includes('SDD-001'))).toBe(true);
  });

  test('requires prior "prdm login" for the linked server', async () => {
    const fetchImpl = fakeServer(200, {});
    await expect(runRemoteSync(root, remoteFile('https://app.example.test'), {}, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl })).rejects.toThrow(CliError);
  });

  test('falls back to GITHUB_REF_NAME in detached HEAD', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    execFileSync('git', ['checkout', '--detach', '-q'], { cwd: root });

    let sentBranch: string | undefined;
    const fetchImpl = (async (url, init) => {
      const path = new URL(url as string | URL).pathname;
      if (path.endsWith('/governance')) return new Response(JSON.stringify({ graphVersion: '1', settings: SETTINGS, documents: [] }), { status: 200 });
      if (path.endsWith('/code-reports')) {
        sentBranch = (JSON.parse(init!.body as string) as { branch: string }).branch;
        return new Response(JSON.stringify({ mode: 'preview', reportId: 'r1', headSha: 'a'.repeat(40), issues: [], hasBlockingIssues: false }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    await runRemoteSync(root, remoteFile('https://app.example.test'), {}, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome, GITHUB_REF_NAME: 'feature/x' }, fetchImpl });
    expect(sentBranch).toBe('feature/x');
  });
});
