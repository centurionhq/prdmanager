import type { Command } from 'commander';
import { migrateDocs, type MigrateDocsResult } from '@prdm/core';
import { formatRefreshReport } from '../format.js';
import { withContext, type CliDeps } from '../program.js';
import { assertLocalMutationAllowed } from '../remote/guard.js';

function formatMigrateDocsResult(result: MigrateDocsResult): string {
  const lines = [`dryRun: ${result.dryRun}`];
  if (result.fieldChanges.length === 0) lines.push('field changes: (none)');
  else {
    lines.push('field changes:');
    for (const change of result.fieldChanges) lines.push(`  ${change.id}  ${change.path}  ${change.changes.join(', ')}`);
  }
  lines.push(`rebaselined blueprints: ${result.rebaselinedBlueprints.join(', ') || '(none)'}`);
  lines.push(`rebaselined work orders: ${result.rebaselinedWorkOrders.join(', ') || '(none)'}`);
  if (result.report) lines.push(formatRefreshReport(result.report));
  return lines.join('\n');
}

async function runMigrateDocs(deps: CliDeps, options: { dryRun?: boolean; json?: boolean }): Promise<void> {
  assertLocalMutationAllowed(deps.root, 'migrate docs');
  await withContext(deps, async (ctx) => {
    const result = await migrateDocs(ctx.engine, { dryRun: options.dryRun });
    deps.stdout(options.json ? JSON.stringify(result, null, 2) : formatMigrateDocsResult(result));
  });
}

export function register(program: Command, deps: CliDeps): void {
  const migrate = program.command('migrate').description('one-time content migrations');

  migrate
    .command('docs')
    .description('rewrite deprecated frontmatter aliases (governs -> impacts_paths, todo -> pending) and re-baseline the Tareas hash exclusion')
    .option('--dry-run', 'print the planned changes without writing anything')
    .option('--json', 'print the result as JSON')
    .action((options: { dryRun?: boolean; json?: boolean }) => runMigrateDocs(deps, options));
}
