import { readFileSync, statSync } from 'node:fs';
import type { Command } from 'commander';
import { checkCommitMessage, checkCommitRange, type CommitRangeEntry } from '@prdm/core';
import { CliError, messageOf } from '../errors.js';
import type { CliDeps } from '../program.js';

const MAX_MESSAGE_BYTES = 64 * 1024;

/** Strips `#`-prefixed comment lines (as `git commit` itself does) before the trailer is parsed. */
function stripComments(message: string): string {
  return message
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');
}

function readMessageFile(path: string): string {
  let size: number;
  try {
    size = statSync(path).size;
  } catch (err) {
    throw new CliError(`cannot read commit message file "${path}": ${messageOf(err)}`);
  }
  if (size > MAX_MESSAGE_BYTES) throw new CliError(`commit message file exceeds ${MAX_MESSAGE_BYTES} bytes`);
  return readFileSync(path, 'utf8');
}

/** Best-effort `--amend` signal (SDD-002 "Ciclo de vida"): `commit-msg` receives no such flag, CI's range check is authoritative. */
function isAmend(env: NodeJS.ProcessEnv): boolean {
  return /amend/i.test(env.GIT_REFLOG_ACTION ?? '');
}

async function runCommitMsg(deps: CliDeps, file: string): Promise<void> {
  const message = stripComments(readMessageFile(file));
  const result = await checkCommitMessage(deps.root, message, { amend: isAmend(process.env) });
  if (!result.ok) throw new CliError(result.message ?? 'commit rejected by prdm commit policy');
}

function formatEntry(entry: CommitRangeEntry): string {
  return `${entry.sha}: ${entry.result.ok ? 'ok' : (entry.result.message ?? 'rejected')}`;
}

async function runCommitsRange(deps: CliDeps, range: string): Promise<void> {
  const check = await checkCommitRange(deps.root, range);
  for (const entry of check.commits.filter((c) => !c.result.ok)) deps.stdout(formatEntry(entry));
  if (check.grandfatheredGrowthMessage) deps.stdout(check.grandfatheredGrowthMessage);
  if (check.orphanCommitsMessage) deps.stdout(check.orphanCommitsMessage);
  if (check.uncoveredPathsMessage) deps.stdout(check.uncoveredPathsMessage);
  if (check.notEnforcedMessage) deps.stdout(check.notEnforcedMessage);
  if (!check.ok) throw new CliError(`prdm check commits --range ${range}: policy violations found`);
  deps.stdout(`prdm check commits --range ${range}: ${check.commits.length} commit(s) ok`);
}

export function register(program: Command, deps: CliDeps): void {
  const check = program.command('check').description('policy checks that require no database context');

  check
    .command('commit-msg')
    .description('validate a commit message against the Refs: enforcement policy (used by the commit-msg hook)')
    .argument('<file>', 'path to the commit message file')
    .action((file: string) => runCommitMsg(deps, file));

  check
    .command('commits')
    .description('validate every commit in a range against the Refs: enforcement policy (CI)')
    .requiredOption('--range <a..b>', 'commit range to check, e.g. origin/main..HEAD')
    .action((options: { range: string }) => runCommitsRange(deps, options.range));
}
