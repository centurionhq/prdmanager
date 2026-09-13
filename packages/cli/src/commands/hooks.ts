import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { installHooks, isGitRepo, parseProjectFile } from '@prdm/core';
import { CliError, messageOf } from '../errors.js';
import type { CliDeps } from '../program.js';

/** Reads and parses `.prdm.yaml` directly, without opening a database context: `hooks install` needs no Neo4j. */
function currentProjectId(root: string): string {
  const path = join(root, '.prdm.yaml');
  if (!existsSync(path)) throw new CliError('no .prdm.yaml found; run `prdm init` first');
  try {
    return parseProjectFile(readFileSync(path, 'utf8')).project.id;
  } catch (err) {
    throw new CliError(messageOf(err));
  }
}

async function runHooksInstall(deps: CliDeps, options: { force?: boolean }): Promise<void> {
  if (!(await isGitRepo(deps.root))) throw new CliError('not a git repository');
  const projectId = currentProjectId(deps.root);
  try {
    const result = await installHooks(deps.root, projectId, { force: options.force });
    for (const path of result.installed) deps.stdout(`installed ${path}`);
    for (const path of result.unchanged) deps.stdout(`unchanged ${path}`);
  } catch (err) {
    throw new CliError(messageOf(err));
  }
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('hooks')
    .description('git hooks integration')
    .command('install')
    .description('install the post-commit and commit-msg hooks (idempotent; respects core.hooksPath)')
    .option('--force', 'accept a hook with an unrecognized shebang')
    .action((options: { force?: boolean }) => runHooksInstall(deps, options));
}
