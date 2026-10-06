import type { Command } from 'commander';
import { watch } from 'chokidar';
import { detectProjectFileMode } from '@prdm/core';
import { formatRefreshReport, summarizeRefresh } from '../format.js';
import { CliError, messageOf } from '../errors.js';
import { createDebouncedRunner } from '../scheduler.js';
import { withContext, type CliDeps } from '../program.js';
import { runRemoteAck, runRemoteSync } from '../remote/sync.js';
import { createIgnoreMatcher } from '../watch-ignore.js';

const DEFAULT_DEBOUNCE_MS = 300;

function parseDebounce(value: string): number {
  const ms = Number.parseInt(value, 10);
  if (!Number.isInteger(ms) || ms < 0) throw new CliError('--debounce must be a non-negative integer');
  return ms;
}

async function runSync(deps: CliDeps, options: { check?: boolean; json?: boolean }): Promise<void> {
  const mode = detectProjectFileMode(deps.root);
  if (mode.kind === 'remote') {
    await runRemoteSync(deps.root, mode.file, options, { stdout: deps.stdout, env: process.env });
    return;
  }
  await withContext(deps, async (ctx) => {
    const report = await ctx.engine.refresh();
    deps.stdout(options.json ? JSON.stringify(report, null, 2) : formatRefreshReport(report));
    if (options.check && report.hasBlockingIssues) throw new CliError('sync check failed: blocking issues found');
  });
}

async function runAck(deps: CliDeps, target: string, options: { reason?: string }): Promise<void> {
  const mode = detectProjectFileMode(deps.root);
  if (mode.kind === 'remote') {
    await runRemoteAck(deps.root, mode.file, target, options, { stdout: deps.stdout, env: process.env });
    return;
  }
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
    .option('--reason <text>', 'why this re-baseline is correct (required in remote mode)')
    .action((target: string, options: { reason?: string }) => runAck(deps, target, options));

  program
    .command('watch')
    .description('watch the repository and refresh the graph on changes')
    .option('--debounce <ms>', 'debounce window in milliseconds', String(DEFAULT_DEBOUNCE_MS))
    .action((options: { debounce: string }) => runWatch(deps, options));
}
