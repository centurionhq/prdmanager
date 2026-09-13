import type { Command } from 'commander';
import { getMetrics } from '../../metrics/metrics.js';
import { formatMetrics } from '../format.js';
import { withContext, type CliDeps } from '../program.js';

async function runMetrics(deps: CliDeps, options: { json?: boolean }): Promise<void> {
  await withContext(deps, async (ctx) => {
    const metrics = await getMetrics(ctx.store);
    deps.stdout(options.json ? JSON.stringify(metrics, null, 2) : formatMetrics(metrics));
  });
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('metrics')
    .description('print the PRD-001 success metrics (§6)')
    .option('--json', 'print metrics as JSON')
    .action((options: { json?: boolean }) => runMetrics(deps, options));
}
