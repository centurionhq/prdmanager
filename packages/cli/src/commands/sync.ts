import { existsSync, promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { watch } from 'chokidar';
import { formatRefreshReport, summarizeRefresh } from '../format.js';
import { CliError, messageOf } from '../errors.js';
import { createDebouncedRunner } from '../scheduler.js';
import { withContext, type CliDeps } from '../program.js';
import { isGitRepo, safeWriteFile } from '@prdm/core';
import { createIgnoreMatcher } from '../watch-ignore.js';

const DEFAULT_DEBOUNCE_MS = 300;
const HOOK_SCRIPT = '#!/bin/sh\nnpm run --silent prdm -- sync || true\n';
const HOOK_MODE = 0o755;

function parseDebounce(value: string): number {
  const ms = Number.parseInt(value, 10);
  if (!Number.isInteger(ms) || ms < 0) throw new CliError('--debounce must be a non-negative integer');
  return ms;
}

async function runSync(deps: CliDeps, options: { check?: boolean; json?: boolean }): Promise<void> {
  await withContext(deps, async (ctx) => {
    const report = await ctx.engine.refresh();
    deps.stdout(options.json ? JSON.stringify(report, null, 2) : formatRefreshReport(report));
    if (options.check && report.hasBlockingIssues) throw new CliError('sync check failed: blocking issues found');
  });
}

async function runAck(deps: CliDeps, target: string): Promise<void> {
  await withContext(deps, async (ctx) => {
    const report = await ctx.engine.acknowledge(target);
    deps.stdout(formatRefreshReport(report));
  });
}

async function runWatch(deps: CliDeps, options: { debounce: string }): Promise<void> {
  const debounceMs = parseDebounce(options.debounce);
  await withContext(deps, async (ctx) => {
    const runner = createDebouncedRunner(async () => {
      try {
        deps.stdout(summarizeRefresh(await ctx.engine.refresh()));
      } catch (err) {
        deps.stderr(messageOf(err));
      }
    }, debounceMs);
    const watcher = watch(deps.root, { ignored: createIgnoreMatcher(deps.root, ctx.config.ignore), ignoreInitial: true });
    watcher.on('all', () => runner.schedule());

    await new Promise<void>((resolveWatch) => {
      process.once('SIGINT', () => {
        runner.stop();
        void watcher.close().finally(resolveWatch);
      });
    });
  });
}

async function runHooksInstall(deps: CliDeps, options: { force?: boolean }): Promise<void> {
  if (!(await isGitRepo(deps.root))) throw new CliError('not a git repository');
  const hookPath = join(deps.root, '.git', 'hooks', 'post-commit');
  if (existsSync(hookPath) && !options.force) throw new CliError(`hook already exists at ${hookPath} (use --force to overwrite)`);
  await safeWriteFile(deps.root, '.git/hooks/post-commit', HOOK_SCRIPT);
  await fsPromises.chmod(hookPath, HOOK_MODE);
  deps.stdout(`installed ${hookPath}`);
}

export function register(program: Command, deps: CliDeps): void {
  const sync = program
    .command('sync')
    .description('detect drift between blueprints, work orders, and code')
    .option('--check', 'exit with a non-zero status when blocking issues are found')
    .option('--json', 'print the refresh report as JSON')
    .action((options: { check?: boolean; json?: boolean }) => runSync(deps, options));

  sync
    .command('ack')
    .description('acknowledge a node (or "all") as the new baseline')
    .argument('<target>', 'node id or "all"')
    .action((target: string) => runAck(deps, target));

  program
    .command('watch')
    .description('watch the repository and refresh the graph on changes')
    .option('--debounce <ms>', 'debounce window in milliseconds', String(DEFAULT_DEBOUNCE_MS))
    .action((options: { debounce: string }) => runWatch(deps, options));

  program
    .command('hooks')
    .description('git hooks integration')
    .command('install')
    .description('install a post-commit hook that runs "prdm sync"')
    .option('--force', 'overwrite an existing hook')
    .action((options: { force?: boolean }) => runHooksInstall(deps, options));
}
