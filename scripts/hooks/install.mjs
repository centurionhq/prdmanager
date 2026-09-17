#!/usr/bin/env node
/**
 * PRD-008 §4.5 (WO-410): `npm run hooks:install`. Writes thin wrappers at `.git/hooks/pre-commit` and
 * `.git/hooks/pre-push` that delegate to the versioned scripts at `scripts/hooks/pre-commit`/`pre-push`
 * (SDD-017 §4.3/4.4). Deliberately does NOT reuse `packages/core/src/scaffold/hooks.ts` (`prdm hooks
 * install`, for `commit-msg`/`post-commit`): that installer *merges* a marker block into whatever else
 * already lives in the hook file, appropriate for a shared governance hook every prdm project gets. This
 * one governs only this repository's own pre-commit/pre-push and refuses outright the moment a foreign
 * hook is already there (SDD-017 §4.5's own criterion), rather than trying to merge with it — a
 * pre-commit/pre-push is far more likely to already carry a project's own conventions (lint-staged,
 * husky, …) than commit-msg/post-commit ever are.
 *
 * Never resolves `core.hooksPath` (unlike `prdm hooks install`, which deliberately does): this installer
 * always writes to `<git-dir>/hooks`, the conventional location, for exactly the simplicity SDD-017 §4.5
 * asks for.
 *
 * The install logic (`planInstall`/`installOne`) takes its directories as plain arguments rather than
 * reading them from `import.meta.dirname`/`process.cwd()` itself, so tests can point it at a disposable
 * fixture directory instead of this repository's own real `.git/hooks` — installing a real, executing
 * pre-commit hook into *this* repo's working tree as a side effect of a test would intercept every other
 * commit made against it for the rest of the process's life, including any other work happening
 * concurrently in the same tree.
 *
 * Usage: node scripts/hooks/install.mjs
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const HOOK_KINDS = ['pre-commit', 'pre-push'];
export const HOOK_MODE = 0o755;

export function wrapperContent(kind) {
  return [
    '#!/bin/sh',
    `# Managed by "npm run hooks:install" (PRD-008 / SDD-017). Delegates to the versioned script at`,
    `# scripts/hooks/${kind} -- edit that file, not this one. Re-running the installer is a no-op once`,
    '# this file matches exactly what it generates; PRDM_SKIP_HOOKS=1 or --no-verify skip the real hook.',
    `exec "$(git rev-parse --show-toplevel)/scripts/hooks/${kind}" "$@"`,
    '',
  ].join('\n');
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

function readIfExists(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Installs (or verifies) one hook wrapper at `hooksDir`. Pure I/O, no `ROOT`/cwd assumptions. */
export function installOne(hooksDir, kind) {
  const path = join(hooksDir, kind);
  const expected = wrapperContent(kind);

  if (isSymlink(path)) {
    return { kind, status: 'refused', message: `refusing to write through symlinked hook file: ${path}` };
  }

  const existing = readIfExists(path);
  if (existing === null) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, expected, 'utf8');
    chmodSync(path, HOOK_MODE);
    return { kind, status: 'installed', path };
  }
  if (existing === expected) {
    return { kind, status: 'unchanged', path };
  }
  return {
    kind,
    status: 'refused',
    message: `${path} already exists and is not this repo's ${kind} wrapper. Not overwriting it -- move it aside (or merge it by hand with scripts/hooks/${kind}) and re-run "npm run hooks:install".`,
  };
}

/** Runs `installOne` for every hook kind against `hooksDir`. */
export function planInstall(hooksDir) {
  return HOOK_KINDS.map((kind) => installOne(hooksDir, kind));
}

export function nodeVersionWarning(nodeVersion = process.versions.node) {
  const major = Number.parseInt(nodeVersion.split('.')[0], 10);
  if (major >= 24) return null;
  return `hooks:install: running under Node ${nodeVersion}, but this repo requires Node >=24 (see .nvmrc). Run "nvm use 24" before committing/pushing.`;
}

function gitDir(root) {
  return execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).trim();
}

function main() {
  const root = resolve(import.meta.dirname, '..', '..');
  const warning = nodeVersionWarning();
  if (warning) console.warn(warning);

  const hooksDir = join(gitDir(root), 'hooks');
  const results = planInstall(hooksDir);

  for (const r of results) {
    if (r.status === 'installed') console.log(`hooks:install: wrote ${r.path}`);
    else if (r.status === 'unchanged') console.log(`hooks:install: ${r.path} already up to date`);
    else console.error(`hooks:install: ${r.message}`);
  }

  if (results.some((r) => r.status === 'refused')) {
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('pre-commit runs: typecheck, then vitest related on staged files (checks test services first if any relate to the db project).');
  console.log('pre-push runs: build, test:unit, test:services:check, test:db, Playwright e2e.');
  console.log('Skip either with PRDM_SKIP_HOOKS=1, or per-command with git commit/push --no-verify.');
  console.log('CI never validates against Neo4j/Postgres -- skipping pre-push means the change ships with no DB validation at all.');
}

// Only run as a CLI, never on import (so tests can import the pure helpers above without side effects).
if (import.meta.url === `file://${process.argv[1]}`) main();
