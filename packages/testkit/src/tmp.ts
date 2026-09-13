import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function makeTmpDir(prefix = 'prdm-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

export function removeDir(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

const GIT_IDENTITY = ['-c', 'user.name=prdm-test', '-c', 'user.email=prdm-test@example.com', '-c', 'commit.gpgsign=false'];

export function git(root: string, ...args: string[]): string {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd: root, encoding: 'utf8' });
}

export function gitInit(root: string): void {
  git(root, 'init', '-q', '-b', 'main');
}

export function commitAll(root: string, message: string): string {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD').trim();
}
