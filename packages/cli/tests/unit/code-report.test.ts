/**
 * `sendCodeReport` (SDD-010 "Sync de developers y drift", WO-195): a fresh `Idempotency-Key` per POST, a
 * `409 docs_outdated` triggers exactly one refetch-and-retry (never a loop), and the GitHub OIDC header
 * is attached only when supplied.
 */
import { GITHUB_OIDC_TOKEN_HEADER, type CodeReportRequest } from '@prdm/contracts';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { buildCodeReportBody, sendCodeReport } from '../../src/remote/code-report.js';

function baseBody(docsGraphVersion: string): CodeReportRequest {
  return {
    schema_version: 1,
    client: { prdm_version: '0.0.0', hash_algo_version: 1 },
    branch: 'main',
    head_sha: 'a'.repeat(40),
    docs_graph_version: docsGraphVersion,
    impacts_hashes: {},
    governed: [],
    governed_warnings: [],
    commits: [],
    dirty: [],
  };
}

function okResponse(headSha: string) {
  return new Response(JSON.stringify({ mode: 'preview', reportId: 'r1', headSha, issues: [], hasBlockingIssues: false }), { status: 200 });
}

describe('sendCodeReport (WO-195)', () => {
  test('sends a fresh Idempotency-Key and attaches the GitHub OIDC header when supplied', async () => {
    const seenHeaders: Record<string, string>[] = [];
    const fetchImpl = (async (_url, init) => {
      seenHeaders.push({ ...(init?.headers as Record<string, string>) });
      return okResponse('a'.repeat(40));
    }) as typeof fetch;

    const result = await sendCodeReport(
      'https://app.example.test',
      'prj_0123456789abcdef',
      't',
      baseBody('1'),
      { root: '.', ignore: [], gitMaxCommits: 500, hashAlgoVersion: 1 },
      'main',
      { fetchImpl, githubOidcToken: 'oidc-jwt', refetch: async () => ({ docsGraphVersion: '2', blueprints: [] }) },
    );

    expect(result.attempts).toBe(1);
    expect(seenHeaders[0]!['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(seenHeaders[0]![GITHUB_OIDC_TOKEN_HEADER]).toBe('oidc-jwt');
  });

  test('omits the GitHub OIDC header outside CI', async () => {
    const seenHeaders: Record<string, string>[] = [];
    const fetchImpl = (async (_url, init) => {
      seenHeaders.push({ ...(init?.headers as Record<string, string>) });
      return okResponse('a'.repeat(40));
    }) as typeof fetch;

    await sendCodeReport('https://app.example.test', 'prj_0123456789abcdef', 't', baseBody('1'), { root: '.', ignore: [], gitMaxCommits: 500, hashAlgoVersion: 1 }, 'main', {
      fetchImpl,
      refetch: async () => ({ docsGraphVersion: '2', blueprints: [] }),
    });

    expect(GITHUB_OIDC_TOKEN_HEADER in seenHeaders[0]!).toBe(false);
  });

  test('a 409 docs_outdated triggers exactly one refetch-and-retry, with a different Idempotency-Key', async () => {
    let root: string | undefined;
    try {
      root = makeTmpDir('prdm-code-report-');
      const { execFileSync } = await import('node:child_process');
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });

      const keys: string[] = [];
      const bodies: CodeReportRequest[] = [];
      let calls = 0;
      const fetchImpl = (async (_url, init) => {
        calls += 1;
        keys.push((init?.headers as Record<string, string>)['idempotency-key']!);
        bodies.push(JSON.parse(init!.body as string) as CodeReportRequest);
        if (calls === 1) return new Response(JSON.stringify({ error: 'docs_outdated' }), { status: 409 });
        return okResponse((JSON.parse(init!.body as string) as CodeReportRequest).head_sha);
      }) as typeof fetch;

      let refetchCalls = 0;
      const result = await sendCodeReport(
        'https://app.example.test',
        'prj_0123456789abcdef',
        't',
        baseBody('1'),
        { root, ignore: [], gitMaxCommits: 500, hashAlgoVersion: 1 },
        'main',
        {
          fetchImpl,
          refetch: async () => {
            refetchCalls += 1;
            return { docsGraphVersion: '2', blueprints: [] };
          },
        },
      );

      expect(result.attempts).toBe(2);
      expect(refetchCalls).toBe(1);
      expect(calls).toBe(2);
      expect(keys[0]).not.toBe(keys[1]);
      expect(bodies[0]!.docs_graph_version).toBe('1');
      expect(bodies[1]!.docs_graph_version).toBe('2');
    } finally {
      if (root) removeDir(root);
    }
  });

  test('a non-docs_outdated 409 is not retried', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'force_push_requires_admin_override' }), { status: 409 });
    }) as typeof fetch;

    await expect(
      sendCodeReport('https://app.example.test', 'prj_0123456789abcdef', 't', baseBody('1'), { root: '.', ignore: [], gitMaxCommits: 500, hashAlgoVersion: 1 }, 'main', {
        fetchImpl,
        refetch: async () => ({ docsGraphVersion: '2', blueprints: [] }),
      }),
    ).rejects.toThrow(CliError);
    expect(calls).toBe(1);
  });
});

describe('buildCodeReportBody (WO-195)', () => {
  test('fails clearly when there is no commit yet (no HEAD)', async () => {
    const root = makeTmpDir('prdm-code-report-empty-');
    try {
      await expect(buildCodeReportBody({ root, ignore: [], gitMaxCommits: 500, hashAlgoVersion: 1, docsGraphVersion: '1', blueprints: [] }, 'main')).rejects.toThrow(CliError);
    } finally {
      removeDir(root);
    }
  });
});
