import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { detectPrdmBin } from '../../src/scaffold/detect-bin.js';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

describe('detectPrdmBin', () => {
  test('prefers an npm script named "prdm"', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'package.json': JSON.stringify({ scripts: { prdm: 'tsx src/index.ts' } }) });
    expect(await detectPrdmBin(root)).toBe('npm run --silent prdm --');
  });

  test('falls back to the workspace-linked binary, quoted', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'node_modules/.bin/prdm': '#!/bin/sh\necho x\n' });
    chmodSync(join(root, 'node_modules', '.bin', 'prdm'), 0o755);
    expect(await detectPrdmBin(root)).toBe(`'${join(root, 'node_modules', '.bin', 'prdm')}'`);
  });

  test('falls back to npx when nothing else is found', async () => {
    root = makeTmpDir();
    expect(await detectPrdmBin(root)).toBe('npx --no-install prdm');
  });

  test('falls back past an unparsable package.json', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'package.json': '{ not json' });
    expect(await detectPrdmBin(root)).toBe('npx --no-install prdm');
  });

  test('ignores a package.json without a "prdm" script', async () => {
    root = makeTmpDir();
    writeFiles(root, { 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }) });
    expect(await detectPrdmBin(root)).toBe('npx --no-install prdm');
  });
});
