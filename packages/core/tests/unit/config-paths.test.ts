import { realpathSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { DEFAULT_FOLDERS } from '../../src/project/types.js';
import { resolveInside } from '../../src/util/paths.js';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

describe('loadConfig', () => {
  test('merges prdm.config.json, .env and explicit env (explicit env wins)', () => {
    root = makeTmpDir();
    writeFiles(root, {
      'prdm.config.json': JSON.stringify({ docsDir: 'spec', triage: { autoLinkMinScore: 3 } }),
      '.env': 'NEO4J_PASSWORD=from-dotenv\nNEO4J_URI=neo4j://dotenv:7687\n',
    });
    const cfg = loadConfig(root, { NEO4J_URI: 'neo4j://127.0.0.1:7999' });
    expect(cfg.docsDir).toBe('spec');
    expect(cfg.triage.autoLinkMinScore).toBe(3);
    expect(cfg.triage.maxCandidates).toBe(5);
    expect(cfg.neo4j).toEqual({ uri: 'neo4j://127.0.0.1:7999', username: 'neo4j', password: 'from-dotenv', database: 'neo4j' });
    expect(cfg.ignore).toContain('node_modules/**');
  });

  test('refuses non-local Neo4j hosts unless explicitly allowed', () => {
    root = makeTmpDir();
    expect(() => loadConfig(root, { NEO4J_PASSWORD: 'x', NEO4J_URI: 'neo4j://attacker.example:7687' })).toThrow(/non-local host/);
    expect(() => loadConfig(root, { NEO4J_PASSWORD: 'x', NEO4J_URI: 'not a uri' })).toThrow(/valid URI/);
    expect(loadConfig(root, { NEO4J_PASSWORD: 'x', NEO4J_URI: 'neo4j://db.internal:7687', PRDM_ALLOW_REMOTE_NEO4J: '1' }).neo4j.uri).toBe('neo4j://db.internal:7687');
    expect(loadConfig(root, { NEO4J_PASSWORD: 'x', NEO4J_URI: 'bolt://localhost:7688' }).neo4j.uri).toBe('bolt://localhost:7688');
  });

  test('fails fast when the Neo4j password is missing', () => {
    root = makeTmpDir();
    expect(() => loadConfig(root, {})).toThrow(/NEO4J_PASSWORD/);
  });

  test('rejects an invalid config file', () => {
    root = makeTmpDir();
    writeFiles(root, { 'prdm.config.json': JSON.stringify({ gitMaxCommits: -1 }) });
    expect(() => loadConfig(root, { NEO4J_PASSWORD: 'x' })).toThrow(/prdm.config.json/);
  });

  test('.prdm.yaml wins over prdm.config.json when both exist (WO-017)', () => {
    root = makeTmpDir();
    writeFiles(root, {
      'prdm.config.json': JSON.stringify({ docsDir: 'ignored-legacy' }),
      '.prdm.yaml': 'version: 1\nproject:\n  id: prj_0123456789abcdef\n  name: yaml-project\nfolders:\n  FR: docs/requests\n',
    });
    const cfg = loadConfig(root, { NEO4J_PASSWORD: 'x' });
    expect(cfg.docsDir).toBe('docs');
    expect(cfg.project).toEqual({ id: 'prj_0123456789abcdef', name: 'yaml-project', root: realpathSync(root) });
    expect(cfg.folders).toEqual({ ...DEFAULT_FOLDERS, FR: 'docs/requests' });
    expect(cfg.ignore).toContain('node_modules/**');
  });

  test('surfaces .prdm.yaml validation errors', () => {
    root = makeTmpDir();
    writeFiles(root, { '.prdm.yaml': 'version: 1\nproject:\n  id: not-valid\n  name: x\n' });
    expect(() => loadConfig(root, { NEO4J_PASSWORD: 'x' })).toThrow(/\.prdm\.yaml is invalid/);
  });
});

describe('resolveInside', () => {
  test('resolves relative paths inside the root as posix', () => {
    const r = resolveInside('/repo', 'src/a/../b.ts');
    expect(r).toEqual({ abs: '/repo/src/b.ts', rel: 'src/b.ts' });
  });

  test.each(['../etc/passwd', '/etc/passwd', 'src/../../x', 'a\0b', ''])('rejects unsafe path %j', (p) => {
    expect(() => resolveInside('/repo', p)).toThrow(/outside|invalid/i);
  });
});
