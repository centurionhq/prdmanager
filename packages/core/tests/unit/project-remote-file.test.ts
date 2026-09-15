import { describe, expect, test } from 'vitest';
import { detectProjectFileMode, parseProjectFile, parseRemoteProjectFile, renderRemoteProjectFile, type RemoteProjectFile } from '@prdm/core';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

function remoteFile(): RemoteProjectFile {
  return {
    version: 2,
    project: { id: 'prj_0123456789abcdef', name: 'widgets' },
    remote: { server: 'https://app.example.com', org: 'acme', project: 'widgets', offlinePolicy: 'warn' },
  };
}

describe('parseRemoteProjectFile (SDD-010, WO-188)', () => {
  test('round-trips through renderRemoteProjectFile', () => {
    const settings = remoteFile();
    const parsed = parseRemoteProjectFile(renderRemoteProjectFile(settings));
    expect(parsed).toEqual(settings);
  });

  test('rejects an unknown field (strict schema)', () => {
    const src = 'version: 2\nproject:\n  id: prj_0123456789abcdef\n  name: widgets\nremote:\n  server: https://app.example.com\n  org: acme\n  project: widgets\n  extra: nope\n';
    expect(() => parseRemoteProjectFile(src)).toThrow(/\.prdm\.yaml is invalid/);
  });

  test('defaults offline_policy to warn', () => {
    const src = 'version: 2\nproject:\n  id: prj_0123456789abcdef\n  name: widgets\nremote:\n  server: https://app.example.com\n  org: acme\n  project: widgets\n';
    expect(parseRemoteProjectFile(src).remote.offlinePolicy).toBe('warn');
  });
});

describe('parseProjectFile on a version: 2 file (SDD-010, WO-188)', () => {
  test('fails with a clear message instead of a generic schema error', () => {
    const src = renderRemoteProjectFile(remoteFile());
    expect(() => parseProjectFile(src)).toThrow(/requires a version of prdm that supports "remote" projects/);
  });

  test('an unrelated invalid version still gets the generic error (no behavior change)', () => {
    const src = 'version: 3\nproject:\n  id: prj_0123456789abcdef\n  name: x\ndocs_dir: docs\nfolders: {}\nignore: []\ngit: {}\ntriage: {}\nlifecycle: {}\nauthoring: {}\n';
    expect(() => parseProjectFile(src)).toThrow(/\.prdm\.yaml is invalid/);
    expect(() => parseProjectFile(src)).not.toThrow(/requires a version of prdm/);
  });
});

describe('detectProjectFileMode (SDD-010, WO-188/WO-190/WO-191)', () => {
  test('none when there is no .prdm.yaml', () => {
    const root = makeTmpDir();
    try {
      expect(detectProjectFileMode(root)).toEqual({ kind: 'none' });
    } finally {
      removeDir(root);
    }
  });

  test('local for a version: 1 file', () => {
    const root = makeTmpDir();
    try {
      writeFiles(root, { '.prdm.yaml': 'version: 1\nproject:\n  id: prj_0123456789abcdef\n  name: x\n' });
      expect(detectProjectFileMode(root)).toEqual({ kind: 'local' });
    } finally {
      removeDir(root);
    }
  });

  test('local for a malformed .prdm.yaml (defers the real error to the local-mode loader)', () => {
    const root = makeTmpDir();
    try {
      writeFiles(root, { '.prdm.yaml': 'not: [valid\n' });
      expect(detectProjectFileMode(root)).toEqual({ kind: 'local' });
    } finally {
      removeDir(root);
    }
  });

  test('remote for a version: 2 file, fully validated', () => {
    const root = makeTmpDir();
    try {
      const settings = remoteFile();
      writeFiles(root, { '.prdm.yaml': renderRemoteProjectFile(settings) });
      expect(detectProjectFileMode(root)).toEqual({ kind: 'remote', file: settings });
    } finally {
      removeDir(root);
    }
  });
});
