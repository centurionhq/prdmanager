/**
 * `loadCredentials`/`saveCredentials` (SDD-010, WO-187): strict permissions, symlink rejection.
 */
import { chmodSync, mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { credentialsPath, InsecureCredentialsPathError, loadCredentials, saveCredentials } from '../../src/remote/credentials.js';

let xdgHome: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  xdgHome = makeTmpDir('prdm-xdg-');
  env = { XDG_CONFIG_HOME: xdgHome };
});

afterEach(() => {
  removeDir(xdgHome);
});

describe('credentials (WO-187)', () => {
  test('loadCredentials returns {} when nothing is stored yet', () => {
    expect(loadCredentials(env)).toEqual({});
  });

  test('saveCredentials creates a 0700 directory and a 0600 file, round-tripping the content', () => {
    saveCredentials({ 'https://a.example.test': { token: 'x' } }, env);
    const loaded = loadCredentials(env);
    expect(loaded).toEqual({ 'https://a.example.test': { token: 'x' } });

    const path = credentialsPath(env);
    const fileMode = statMode(path);
    expect(fileMode).toBe(0o600);
    const dirMode = statMode(join(xdgHome, 'prdm'));
    expect(dirMode).toBe(0o700);
  });

  test('rejects a symlinked credentials file instead of following it', () => {
    const realDir = makeTmpDir('prdm-real-target-');
    try {
      const realFile = join(realDir, 'elsewhere.json');
      writeFileSync(realFile, '{}', { mode: 0o600 });
      mkdirSync(join(xdgHome, 'prdm'), { recursive: true, mode: 0o700 });
      symlinkSync(realFile, credentialsPath(env));

      expect(() => loadCredentials(env)).toThrow(InsecureCredentialsPathError);
      expect(() => saveCredentials({}, env)).toThrow(InsecureCredentialsPathError);
    } finally {
      removeDir(realDir);
    }
  });

  test('rejects a world-readable existing credentials file before overwriting it', () => {
    mkdirSync(join(xdgHome, 'prdm'), { recursive: true, mode: 0o700 });
    const path = credentialsPath(env);
    writeFileSync(path, '{}', { mode: 0o600 });
    chmodSync(path, 0o644); // world-readable

    expect(() => loadCredentials(env)).toThrow(InsecureCredentialsPathError);
    expect(() => saveCredentials({ x: { token: 'y' } }, env)).toThrow(InsecureCredentialsPathError);
  });
});

function statMode(path: string): number {
  return statSync(path).mode & 0o777;
}
