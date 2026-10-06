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
import { saveCredentials, saveProjectPin } from '../../src/remote/credentials.js';
import { formatRefreshReport } from '../../src/format.js';
import { runRemoteAck, runRemoteSync } from '../../src/remote/sync.js';

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
    saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef' }, { XDG_CONFIG_HOME: xdgHome });
    const lines: string[] = [];
    const fetchImpl = fakeServer(200, { mode: 'preview', reportId: 'r1', headSha: 'a'.repeat(40), issues: [], hasBlockingIssues: false });

    await runRemoteSync(root, remoteFile('https://app.example.test'), { check: true }, { stdout: (l) => lines.push(l), env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });

    expect(lines.some((l) => l.includes('mode: preview'))).toBe(true);
    expect(lines.some((l) => l.includes('drift: none'))).toBe(true);
  });

  test('--check throws when the server reports blocking issues', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef' }, { XDG_CONFIG_HOME: xdgHome });
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
    saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef' }, { XDG_CONFIG_HOME: xdgHome });
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
    saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef' }, { XDG_CONFIG_HOME: xdgHome });
    const fetchImpl = fakeServer(200, {});
    await expect(runRemoteSync(root, remoteFile('https://app.example.test'), {}, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl })).rejects.toThrow(CliError);
  });

  test('aborts (sends nothing) when .prdm.yaml\'s project.id disagrees with the locally pinned graphProjectId (WO-234)', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    // Simulates a PR that edited only .prdm.yaml's project.id after this repo was already linked.
    saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_fedcba9876543210' }, { XDG_CONFIG_HOME: xdgHome });
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('should never be reached', { status: 200 });
    }) as typeof fetch;

    await expect(runRemoteSync(root, remoteFile('https://app.example.test'), {}, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl })).rejects.toThrow(CliError);
    expect(called).toBe(false);
  });

  test('aborts when this repository was never linked from this machine (no local project pin at all)', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    const fetchImpl = fakeServer(200, {});
    await expect(runRemoteSync(root, remoteFile('https://app.example.test'), {}, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl })).rejects.toThrow(CliError);
  });

  test('WO-395 regression: succeeds in CI with no local project pin at all, checked against PRDM_PROJECT_ID instead', async () => {
    const lines: string[] = [];
    const fetchImpl = fakeServer(200, { mode: 'baseline', reportId: 'r1', headSha: 'a'.repeat(40), issues: [], hasBlockingIssues: false });
    await runRemoteSync(
      root,
      remoteFile('https://app.example.test'),
      {},
      {
        stdout: (l) => lines.push(l),
        env: { XDG_CONFIG_HOME: xdgHome, CI: 'true', PRDM_SERVER: 'https://app.example.test', PRDM_TOKEN: 't', PRDM_PROJECT_ID: 'prj_0123456789abcdef' },
        fetchImpl,
      },
    );
    expect(lines.join('\n')).toContain('drift: none');
  });

  test('aborts in CI when PRDM_PROJECT_ID is not set (never falls back to a local pin under CI)', async () => {
    const fetchImpl = fakeServer(200, {});
    await expect(
      runRemoteSync(
        root,
        remoteFile('https://app.example.test'),
        {},
        { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome, CI: 'true', PRDM_SERVER: 'https://app.example.test', PRDM_TOKEN: 't' }, fetchImpl },
      ),
    ).rejects.toThrow(/PRDM_PROJECT_ID is required in CI/);
  });

  test('falls back to GITHUB_REF_NAME in detached HEAD', async () => {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef' }, { XDG_CONFIG_HOME: xdgHome });
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

describe('runRemoteAck (WO-691)', () => {
  const ACK_REPORT = { documents: 0, errors: [], governed: [], issues: [], workOrderUpdates: [], baselineWritten: true, hasBlockingIssues: false };

  function linkAndLogin(): void {
    saveCredentials({ 'https://app.example.test': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    saveProjectPin(root, { server: 'https://app.example.test', graphProjectId: 'prj_0123456789abcdef' }, { XDG_CONFIG_HOME: xdgHome });
  }

  test('without --reason it fails and never calls the server', async () => {
    linkAndLogin();
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    for (const reason of [undefined, '', '   ']) {
      await expect(runRemoteAck(root, remoteFile('https://app.example.test'), 'all', { reason }, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl })).rejects.toThrow(CliError);
    }
    expect(called).toBe(false);
  });

  test('validates --reason before resolving the server origin (CI=true, no PRDM_SERVER)', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const env = { XDG_CONFIG_HOME: xdgHome, CI: 'true' };

    for (const [reason, expected] of [
      [undefined, '--reason is required'],
      ['   ', '--reason is required'],
      ['x'.repeat(501), '--reason must be 500 characters or fewer'],
    ] as const) {
      const attempt = runRemoteAck(root, remoteFile('https://app.example.test'), 'all', { reason }, { stdout: () => undefined, env, fetchImpl });
      await expect(attempt).rejects.toThrow(CliError);
      await expect(attempt).rejects.toThrow(expected);
      await expect(attempt).rejects.not.toThrow('PRDM_SERVER is required in CI');
    }
    expect(called).toBe(false);
  });

  test('posts { target, reason } with the bearer token and prints the report like local mode', async () => {
    linkAndLogin();
    const lines: string[] = [];
    let seen: { url: string; auth: string | null; body: unknown } | undefined;
    const fetchImpl = (async (url, init) => {
      seen = { url: String(url), auth: new Headers(init!.headers).get('authorization'), body: JSON.parse(init!.body as string) };
      return new Response(JSON.stringify({ report: ACK_REPORT }), { status: 200 });
    }) as typeof fetch;

    await runRemoteAck(root, remoteFile('https://app.example.test'), 'all', { reason: 'baseline reviewed' }, { stdout: (l) => lines.push(l), env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl });

    expect(seen?.url).toBe('https://app.example.test/api/v1/projects/prj_0123456789abcdef/drift/acknowledge');
    expect(seen?.auth).toBe('Bearer t');
    expect(seen?.body).toEqual({ target: 'all', reason: 'baseline reviewed' });
    expect(lines).toEqual([formatRefreshReport(ACK_REPORT)]);
    expect(lines[0]).toContain('documents: 0');
    expect(lines[0]).toContain('issues: 0');
    expect(lines[0]).toContain('baselineWritten: true');
  });

  test('a rejected response becomes a CliError carrying the status', async () => {
    linkAndLogin();
    const fetchImpl = (async () => new Response('forbidden', { status: 403 })) as typeof fetch;

    await expect(
      runRemoteAck(root, remoteFile('https://app.example.test'), 'all', { reason: 'x' }, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome }, fetchImpl }),
    ).rejects.toThrow(/403/);
  });
});
