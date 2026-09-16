import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AlreadyLocalProjectError, applyLink, ConflictingRemoteLinkError, parseRemoteProjectFile, planLink, type PlanLinkInput } from '@prdm/core';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

function baseInput(overrides: Partial<PlanLinkInput> = {}): PlanLinkInput {
  return {
    projectId: 'prj_0123456789abcdef',
    projectName: 'widgets',
    server: 'https://app.example.com',
    org: 'acme',
    project: 'widgets',
    offlinePolicy: 'warn',
    ...overrides,
  };
}

describe('planLink/applyLink (SDD-010, WO-188)', () => {
  test('writes .prdm.yaml version 2 and adds .prdm/remote/ to .gitignore', async () => {
    const root = makeTmpDir();
    try {
      const plan = await planLink(root, baseInput());
      await applyLink(root, plan);

      const remoteFile = parseRemoteProjectFile(readFileSync(join(root, '.prdm.yaml'), 'utf8'));
      expect(remoteFile.project.id).toBe('prj_0123456789abcdef');
      expect(remoteFile.remote).toEqual({ server: 'https://app.example.com', org: 'acme', project: 'widgets', offlinePolicy: 'warn' });

      const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.prdm/remote/');
      expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    } finally {
      removeDir(root);
    }
  });

  test('--mcp adds the prdm-remote stdio entry, with no secrets', async () => {
    const root = makeTmpDir();
    try {
      const plan = await planLink(root, baseInput({ mcp: true }));
      await applyLink(root, plan);

      const mcpJson = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
      expect(mcpJson.mcpServers['prdm-remote']).toEqual({ command: 'prdm', args: ['mcp-proxy'] });
      expect(JSON.stringify(mcpJson)).not.toMatch(/token|secret|bearer/i);
    } finally {
      removeDir(root);
    }
  });

  test('is idempotent: a second identical link produces no writes', async () => {
    const root = makeTmpDir();
    try {
      await applyLink(root, await planLink(root, baseInput({ mcp: true })));
      const second = await planLink(root, baseInput({ mcp: true }));
      expect(second.writes).toEqual([]);
    } finally {
      removeDir(root);
    }
  });

  test('running --mcp a second time does not duplicate the .gitignore entry', async () => {
    const root = makeTmpDir();
    try {
      await applyLink(root, await planLink(root, baseInput()));
      await applyLink(root, await planLink(root, baseInput({ mcp: true })));
      const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
      expect(gitignore.split('\n').filter((line) => line === '.prdm/remote/')).toHaveLength(1);
    } finally {
      removeDir(root);
    }
  });

  test('refuses to overwrite an existing local (version 1) project', async () => {
    const root = makeTmpDir();
    try {
      writeFiles(root, { '.prdm.yaml': 'version: 1\nproject:\n  id: prj_0123456789abcdef\n  name: x\n' });
      await expect(planLink(root, baseInput())).rejects.toBeInstanceOf(AlreadyLocalProjectError);
    } finally {
      removeDir(root);
    }
  });

  test('allows overwriting an existing local project when importing (FB-009)', async () => {
    const root = makeTmpDir();
    try {
      writeFiles(root, { '.prdm.yaml': 'version: 1\nproject:\n  id: prj_0123456789abcdef\n  name: x\n' });
      const plan = await planLink(root, baseInput({ importing: true }));
      await applyLink(root, plan);

      const remoteFile = parseRemoteProjectFile(readFileSync(join(root, '.prdm.yaml'), 'utf8'));
      expect(remoteFile.project.id).toBe('prj_0123456789abcdef');
      expect(remoteFile.remote).toEqual({ server: 'https://app.example.com', org: 'acme', project: 'widgets', offlinePolicy: 'warn' });
      expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.prdm/remote/');
    } finally {
      removeDir(root);
    }
  });

  test('refuses to silently relink to a different remote project', async () => {
    const root = makeTmpDir();
    try {
      await applyLink(root, await planLink(root, baseInput()));
      await expect(planLink(root, baseInput({ project: 'other' }))).rejects.toBeInstanceOf(ConflictingRemoteLinkError);
    } finally {
      removeDir(root);
    }
  });
});
