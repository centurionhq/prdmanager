import type { Command } from 'commander';
import type { DriftIssue } from '@prdm/core';
import { formatIssues, formatRefreshReport, formatScanErrors } from '../format.js';
import { CliError } from '../errors.js';
import { withContext, type CliDeps } from '../program.js';

const LINT_ISSUE_KINDS: ReadonlySet<DriftIssue['kind']> = new Set(['broken_link', 'invalid_link_target', 'impacts_warning']);

async function runIndex(deps: CliDeps): Promise<void> {
  await withContext(deps, async (ctx) => {
    await ctx.store.migrate();
    const report = await ctx.engine.refresh();
    deps.stdout(formatRefreshReport(report));
  });
}

async function runLint(deps: CliDeps): Promise<void> {
  await withContext(deps, async (ctx) => {
    const report = await ctx.engine.refresh();
    const lintIssues = report.issues.filter((issue) => LINT_ISSUE_KINDS.has(issue.kind));

    deps.stdout(`documents: ${report.documents}`);
    if (report.errors.length > 0) deps.stdout(formatScanErrors(report.errors));
    if (lintIssues.length > 0) deps.stdout(formatIssues(lintIssues));
    if (report.errors.length === 0 && lintIssues.length === 0) deps.stdout('lint clean');

    const hasLinkErrors = lintIssues.some((issue) => issue.severity === 'error');
    if (report.errors.length > 0 || hasLinkErrors) throw new CliError('lint failed: scan errors or broken links found');
  });
}

export function register(program: Command, deps: CliDeps): void {
  program.command('index').description('migrate the schema and reindex all documents into Neo4j').action(() => runIndex(deps));

  program.command('lint').description('scan documents and report broken or invalid links').action(() => runLint(deps));
}
