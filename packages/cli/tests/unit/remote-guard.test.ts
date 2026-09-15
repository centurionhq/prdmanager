/**
 * Local mutating CLI commands refuse when the repository is linked to a remote project (SDD-010 "Modo
 * remoto", WO-191). Every case here runs against a `version: 2` `.prdm.yaml` with no Neo4j fixture at
 * all — the guard must fire before `withContext` ever tries to open a database connection.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderRemoteProjectFile, type RemoteProjectFile } from '@prdm/core';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../../src/program.js';
import { CliError } from '../../src/errors.js';
import { assertLocalMutationAllowed } from '../../src/remote/guard.js';

function remoteFile(): RemoteProjectFile {
  return { version: 2, project: { id: 'prj_0123456789abcdef', name: 'x' }, remote: { server: 'https://app.example.com', org: 'acme', project: 'x', offlinePolicy: 'warn' } };
}

describe('assertLocalMutationAllowed (WO-191)', () => {
  test('throws a dashboard/remote-MCP-pointing CliError for a remote-linked root', () => {
    const root = makeTmpDir();
    try {
      writeFileSync(join(root, '.prdm.yaml'), renderRemoteProjectFile(remoteFile()));
      expect(() => assertLocalMutationAllowed(root, 'wo generate')).toThrow(CliError);
      expect(() => assertLocalMutationAllowed(root, 'wo generate')).toThrow(/dashboard or the remote MCP/);
    } finally {
      removeDir(root);
    }
  });

  test('does nothing for a local (or no) project', () => {
    const root = makeTmpDir();
    try {
      expect(() => assertLocalMutationAllowed(root, 'wo generate')).not.toThrow();
    } finally {
      removeDir(root);
    }
  });
});

describe('mutating CLI commands reject in remote mode (WO-191)', () => {
  let root: string;
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    root = makeTmpDir('prdm-remote-guard-');
    writeFileSync(join(root, '.prdm.yaml'), renderRemoteProjectFile(remoteFile()));
    stdout = [];
    stderr = [];
  });

  afterEach(() => {
    removeDir(root);
  });

  async function run(...args: string[]): Promise<number> {
    return runCli(['node', 'prdm', ...args], { root, stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l) });
  }

  const cases: { name: string; args: string[] }[] = [
    { name: 'wo generate', args: ['wo', 'generate', 'SDD-001'] },
    { name: 'wo claim', args: ['wo', 'claim', 'WO-001', '--as', 'agent:x'] },
    { name: 'wo complete', args: ['wo', 'complete', 'WO-001'] },
    { name: 'feedback add', args: ['feedback', 'add', '--source', 'email', '--text', 'hi'] },
    { name: 'fr create', args: ['fr', 'create', '--title', 'x', '--parent', 'PRD-001'] },
    { name: 'ingest artifact', args: ['ingest', 'artifact', '/nonexistent/file.txt', '--source', 'other'] },
    { name: 'close', args: ['close', 'PRD-001', '--ack', '--by', 'agent:x'] },
    { name: 'sync ack', args: ['sync', 'ack', 'all'] },
    { name: 'migrate docs', args: ['migrate', 'docs'] },
  ];

  for (const { name, args } of cases) {
    test(`${name} is rejected with a dashboard/remote-MCP message`, async () => {
      const code = await run(...args);
      expect(code).not.toBe(0);
      expect(stderr.some((l) => l.includes('not available for a remote-linked project'))).toBe(true);
    });
  }

  test('read-only "wo list" is not caught by the mutating-command guard', async () => {
    const code = await run('wo', 'list');
    expect(code).not.toBe(0); // no Neo4j fixture in this suite; it still fails, just not with the remote-guard message
    expect(stderr.some((l) => l.includes('not available for a remote-linked project'))).toBe(false);
  });
});
