/**
 * `syncGovernanceCache` (SDD-010 "Sync de developers y drift", WO-195): writes only under
 * `.prdm/remote/`, rejects a traversal-style id even if it somehow reached this layer, never follows a
 * symlink planted at the cache-write target, reuses the cache on `304`, and prunes stale ids on `200`.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { syncGovernanceCache } from '../../src/remote/governance-cache.js';

const SETTINGS = { folders: {}, ignore: [], git: {}, triage: {}, lifecycle: {}, default_branch: 'main', github_repository: null, github_repository_id: null, github_owner_id: null, hash_algo_version: 1 };

function governanceResponse(graphVersion: string, documents: { id: string; sourcePath: string; content: string }[]) {
  return { graphVersion, settings: SETTINGS, documents };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

let root: string;

beforeEach(() => {
  root = makeTmpDir('prdm-gov-cache-');
});

afterEach(() => {
  removeDir(root);
});

describe('syncGovernanceCache (WO-195)', () => {
  test('writes each document only under .prdm/remote/docs/, plus a manifest and settings.json', async () => {
    const fetchImpl = (async () => jsonResponse(governanceResponse('3', [{ id: 'PRD-001', sourcePath: 'docs/prd/PRD-001.md', content: '# hi' }]))) as typeof fetch;

    const result = await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl });
    expect(result.graphVersion).toBe('3');
    expect(result.unchanged).toBe(false);
    expect(result.documents).toEqual([{ id: 'PRD-001', sourcePath: '.prdm/remote/docs/PRD-001.md', content: '# hi' }]);
    expect(readFileSync(join(root, '.prdm/remote/docs/PRD-001.md'), 'utf8')).toBe('# hi');
    expect(existsSync(join(root, '.prdm/remote/manifest.json'))).toBe(true);
    expect(existsSync(join(root, '.prdm/remote/settings.json'))).toBe(true);
  });

  test('rejects a server-returned document whose id is a path-traversal attempt', async () => {
    // A raw response can name any string as `id`; even if some future change ever loosened the schema,
    // `syncGovernanceCache` itself must still refuse before writing anything.
    const fetchImpl = (async () =>
      jsonResponse({ graphVersion: '1', settings: SETTINGS, documents: [{ id: '../../etc/passwd', sourcePath: 'x', content: 'evil' }] })) as typeof fetch;

    await expect(syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl })).rejects.toThrow(CliError);
    expect(existsSync(join(root, '.prdm', 'remote'))).toBe(false);
    expect(existsSync(join(root, '..', 'etc', 'passwd'))).toBe(false);
  });

  test('never follows a symlink planted at the cache-write target', async () => {
    const secretPath = join(root, 'secret.txt');
    writeFileSync(secretPath, 'do-not-touch');
    mkdirSync(join(root, '.prdm/remote/docs'), { recursive: true });
    symlinkSync(secretPath, join(root, '.prdm/remote/docs/PRD-001.md'));

    const fetchImpl = (async () => jsonResponse(governanceResponse('1', [{ id: 'PRD-001', sourcePath: 'docs/prd/PRD-001.md', content: 'new content' }]))) as typeof fetch;
    await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl });

    // The symlink's target must be untouched...
    expect(readFileSync(secretPath, 'utf8')).toBe('do-not-touch');
    // ...and the cache path itself must now be a plain, replaced file holding the new content, not a
    // symlink that was written through.
    expect(lstatSync(join(root, '.prdm/remote/docs/PRD-001.md')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, '.prdm/remote/docs/PRD-001.md'), 'utf8')).toBe('new content');
  });

  test('sends If-None-Match on a second sync and reuses the cache on 304', async () => {
    let seenIfNoneMatch: string | undefined;
    let calls = 0;
    const fetchImpl = (async (_url, init) => {
      calls += 1;
      seenIfNoneMatch = (init?.headers as Record<string, string> | undefined)?.['if-none-match'];
      if (calls === 1) return jsonResponse(governanceResponse('7', [{ id: 'PRD-001', sourcePath: 'docs/prd/PRD-001.md', content: 'v1' }]));
      return new Response(null, { status: 304 });
    }) as typeof fetch;

    await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl });
    const second = await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl });

    expect(seenIfNoneMatch).toBe('"7"');
    expect(second.unchanged).toBe(true);
    expect(second.documents).toEqual([{ id: 'PRD-001', sourcePath: '.prdm/remote/docs/PRD-001.md', content: 'v1' }]);
  });

  test('prunes a cached document that is no longer in the server response', async () => {
    const fetchImpl1 = (async () =>
      jsonResponse(
        governanceResponse('1', [
          { id: 'PRD-001', sourcePath: 'docs/prd/PRD-001.md', content: 'v1' },
          { id: 'PRD-002', sourcePath: 'docs/prd/PRD-002.md', content: 'v2' },
        ]),
      )) as typeof fetch;
    await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl: fetchImpl1 });
    expect(existsSync(join(root, '.prdm/remote/docs/PRD-002.md'))).toBe(true);

    const fetchImpl2 = (async () => jsonResponse(governanceResponse('2', [{ id: 'PRD-001', sourcePath: 'docs/prd/PRD-001.md', content: 'v1' }]))) as typeof fetch;
    const result = await syncGovernanceCache(root, 'https://app.example.test', 'prj_0123456789abcdef', 't', { fetchImpl: fetchImpl2 });

    expect(result.documents.map((d) => d.id)).toEqual(['PRD-001']);
    expect(existsSync(join(root, '.prdm/remote/docs/PRD-002.md'))).toBe(false);
  });
});
