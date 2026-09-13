import { resolve } from 'node:path';
import type { Command } from 'commander';
import { applyInit, installHooks, isGitRepo, planInit, type InitOptions } from '@prdm/core';
import { CliError, messageOf } from '../errors.js';
import type { CliDeps } from '../program.js';

export interface InitCliOptions {
  name?: string;
  adopt?: boolean;
  /** Commander maps `--no-hooks` to `hooks: false`; hooks install by default. */
  hooks?: boolean;
  mcp?: boolean;
  force?: boolean;
}

/**
 * `prdm init` never opens a database context: it only writes local files and git hooks (SDD-002 "Proyecto activo"),
 * so it works before `NEO4J_PASSWORD`/Neo4j exist at all.
 */
async function runInit(deps: CliDeps, dir: string | undefined, options: InitCliOptions): Promise<void> {
  const target = resolve(deps.root, dir ?? '.');
  const initOptions: InitOptions = { name: options.name, adopt: options.adopt, mcp: options.mcp, force: options.force };

  let plan;
  try {
    plan = await planInit(target, initOptions);
  } catch (err) {
    throw new CliError(messageOf(err));
  }
  await applyInit(target, plan);

  if (plan.writes.length === 0) deps.stdout('nothing to do: already up to date');
  else for (const write of plan.writes) deps.stdout(`wrote ${write.path}`);
  for (const note of plan.notes) deps.stdout(`note: ${note}`);

  if (options.hooks !== false) {
    if (!(await isGitRepo(target))) throw new CliError(`${target} is not a git repository; re-run with --no-hooks, or run "git init" first`);
    const result = await installHooks(target, plan.projectFile.project.id, { force: options.force });
    for (const path of result.installed) deps.stdout(`installed hook ${path}`);
    if (result.installed.length === 0) deps.stdout('hooks already up to date');
  }
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('init')
    .description('scaffold .prdm.yaml, document folders and git hooks for a new (or adopted) project')
    .argument('[dir]', 'target directory', '.')
    .option('--name <name>', 'project name (defaults to the target directory name)')
    .option('--adopt', 'convert an existing prdm.config.json into .prdm.yaml')
    .option('--no-hooks', 'skip installing git hooks')
    .option('--mcp', 'add the prdm-graph server to .mcp.json')
    .option('--force', 'regenerate an invalid .prdm.yaml, or accept a hook with an unrecognized shebang')
    .action((dir: string | undefined, options: InitCliOptions) => runInit(deps, dir, options));
}
