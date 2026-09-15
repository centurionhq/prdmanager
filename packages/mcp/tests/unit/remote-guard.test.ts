/**
 * The local stdio `prdm-graph` server refuses to run for a remote-linked repository (SDD-010 "Modo
 * remoto", WO-191).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderRemoteProjectFile, type RemoteProjectFile } from '@prdm/core';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { describe, expect, test } from 'vitest';
import { assertNotRemoteProject, RemoteProjectStdioServerError } from '../../src/remote-guard.js';

function remoteFile(): RemoteProjectFile {
  return { version: 2, project: { id: 'prj_0123456789abcdef', name: 'x' }, remote: { server: 'https://app.example.com', org: 'acme', project: 'x', offlinePolicy: 'warn' } };
}

describe('assertNotRemoteProject (WO-191)', () => {
  test('refuses with a message pointing to prdm mcp-proxy for a remote-linked root', () => {
    const root = makeTmpDir();
    try {
      writeFileSync(join(root, '.prdm.yaml'), renderRemoteProjectFile(remoteFile()));
      expect(() => assertNotRemoteProject(root)).toThrow(RemoteProjectStdioServerError);
      expect(() => assertNotRemoteProject(root)).toThrow(/prdm mcp-proxy/);
    } finally {
      removeDir(root);
    }
  });

  test('does nothing for a local (or no) project', () => {
    const root = makeTmpDir();
    try {
      expect(() => assertNotRemoteProject(root)).not.toThrow();
    } finally {
      removeDir(root);
    }
  });
});
