/**
 * `loadCredentials`/`saveCredentials` (SDD-010, WO-187): strict permissions, symlink rejection.
 */
import { chmodSync, mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { checkProjectPinMismatch, credentialsPath, InsecureCredentialsPathError, loadCredentials, loadProjectPin, saveCredentials, saveProjectPin } from '../../src/remote/credentials.js';

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

describe('project pins (WO-234)', () => {
  test('loadProjectPin returns undefined when this repo was never linked from this machine', () => {
    expect(loadProjectPin('/repo/a', env)).toBeUndefined();
  });

  test('saveProjectPin round-trips, keyed by the resolved repo root, independent of stored tokens', () => {
    saveCredentials({ 'https://a.example.test': { token: 'x' } }, env);
    saveProjectPin('/repo/a', { server: 'https://a.example.test', graphProjectId: 'prj_0000000000000001' }, env);

    expect(loadProjectPin('/repo/a', env)).toEqual({ server: 'https://a.example.test', graphProjectId: 'prj_0000000000000001' });
    // Saving a pin never disturbs already-stored tokens.
    expect(loadCredentials(env)).toEqual({ 'https://a.example.test': { token: 'x' } });
  });

  test('two different repos each get their own independent pin', () => {
    saveProjectPin('/repo/a', { server: 'https://a.example.test', graphProjectId: 'prj_0000000000000001' }, env);
    saveProjectPin('/repo/b', { server: 'https://a.example.test', graphProjectId: 'prj_0000000000000002' }, env);

    expect(loadProjectPin('/repo/a', env)?.graphProjectId).toBe('prj_0000000000000001');
    expect(loadProjectPin('/repo/b', env)?.graphProjectId).toBe('prj_0000000000000002');
  });

  test('saveCredentials (login/logout) never wipes out an already-recorded project pin', () => {
    saveProjectPin('/repo/a', { server: 'https://a.example.test', graphProjectId: 'prj_0000000000000001' }, env);
    saveCredentials({ 'https://a.example.test': { token: 'new-token' } }, env);

    expect(loadProjectPin('/repo/a', env)).toEqual({ server: 'https://a.example.test', graphProjectId: 'prj_0000000000000001' });
  });

  test('a pre-WO-234 credentials file (bare token map, no "tokens" wrapper) is read as legacy tokens with no pins', () => {
    mkdirSync(join(xdgHome, 'prdm'), { recursive: true, mode: 0o700 });
    writeFileSync(credentialsPath(env), JSON.stringify({ 'https://a.example.test': { token: 'legacy' } }), { mode: 0o600 });

    expect(loadCredentials(env)).toEqual({ 'https://a.example.test': { token: 'legacy' } });
    expect(loadProjectPin('/repo/a', env)).toBeUndefined();
  });
});

describe('checkProjectPinMismatch (WO-234, CI exemption added by WO-395)', () => {
  test('rejects with no pin recorded at all', () => {
    expect(checkProjectPinMismatch('/repo/a', 'prj_0000000000000001', env)).toMatch(/no local project pin recorded/);
  });

  test('rejects when the pinned graphProjectId disagrees with .prdm.yaml\'s', () => {
    saveProjectPin('/repo/a', { server: 'https://a.example.test', graphProjectId: 'prj_0000000000000001' }, env);
    expect(checkProjectPinMismatch('/repo/a', 'prj_fedcba9876543210', env)).toMatch(/refusing to guess which one is correct/);
  });

  test('passes when the pin agrees', () => {
    saveProjectPin('/repo/a', { server: 'https://a.example.test', graphProjectId: 'prj_0000000000000001' }, env);
    expect(checkProjectPinMismatch('/repo/a', 'prj_0000000000000001', env)).toBeNull();
  });

  test('in CI, checks PRDM_PROJECT_ID instead of the (never-recorded) local pin', () => {
    expect(checkProjectPinMismatch('/repo/a', 'prj_0000000000000001', { ...env, CI: 'true', PRDM_PROJECT_ID: 'prj_0000000000000001' })).toBeNull();
    expect(checkProjectPinMismatch('/repo/a', 'prj_0000000000000001', { ...env, CI: '1', PRDM_PROJECT_ID: 'prj_0000000000000001' })).toBeNull();
  });

  test('in CI, rejects when PRDM_PROJECT_ID is not set, even with a local pin recorded (never trusted in CI)', () => {
    saveProjectPin('/repo/a', { server: 'https://a.example.test', graphProjectId: 'prj_0000000000000001' }, env);
    expect(checkProjectPinMismatch('/repo/a', 'prj_0000000000000001', { ...env, CI: 'true' })).toMatch(/PRDM_PROJECT_ID is required in CI/);
  });

  test('in CI, rejects when PRDM_PROJECT_ID disagrees with .prdm.yaml\'s project.id', () => {
    expect(checkProjectPinMismatch('/repo/a', 'prj_0000000000000001', { ...env, CI: 'true', PRDM_PROJECT_ID: 'prj_fedcba9876543210' })).toMatch(
      /refusing to guess which one is correct/,
    );
  });
});

function statMode(path: string): number {
  return statSync(path).mode & 0o777;
}
