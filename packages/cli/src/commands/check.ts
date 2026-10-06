import { readFileSync, statSync } from 'node:fs';
import type { Command } from 'commander';
import {
  checkBranchRefs,
  checkCommitMessage,
  checkCommitRange,
  detectProjectFileMode,
  type BranchRefMismatch,
  type BranchRefsCheck,
  type CommitRangeEntry,
} from '@prdm/core';
import { CliError, messageOf } from '../errors.js';
import type { CliDeps } from '../program.js';
import { runRemoteCheckRange } from '../remote/check-range.js';
import { runRemoteCommitMsg } from '../remote/commit-msg.js';

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
  const options = { amend: isAmend(process.env) };

  const mode = detectProjectFileMode(deps.root);
  if (mode.kind === 'remote') {
    const { result, warning } = await runRemoteCommitMsg(deps.root, mode.file, message, options, { env: process.env });
    if (warning) deps.stderr(`warning: ${warning}`);
    if (!result.ok) throw new CliError(result.message ?? 'commit rejected by prdm commit policy');
    return;
  }

  const result = await checkCommitMessage(deps.root, message, options);
  if (!result.ok) throw new CliError(result.message ?? 'commit rejected by prdm commit policy');
}

function formatEntry(entry: CommitRangeEntry): string {
  return `${entry.sha}: ${entry.result.ok ? 'ok' : (entry.result.message ?? 'rejected')}`;
}

function formatBranchWarning(check: BranchRefsCheck, mismatch: BranchRefMismatch): string {
  const actual = mismatch.refs.length > 0 ? mismatch.refs.join(', ') : '(none)';
  return `warning: ${mismatch.sha}: branch "${check.branch}" declares ${mismatch.expected} but the commit's Refs: is ${actual}`;
}

/** Warns per misaligned commit; with `--strict` the caller turns a non-zero count into a failure. */
async function warnBranchMismatches(deps: CliDeps, range: string): Promise<number> {
  const branchCheck = await checkBranchRefs(deps.root, range);
  for (const mismatch of branchCheck.mismatches) deps.stderr(formatBranchWarning(branchCheck, mismatch));
  return branchCheck.mismatches.length;
}

function failOnBranchMismatch(range: string, count: number, strict: boolean): void {
  if (strict && count > 0) {
    throw new CliError(`prdm check commits --range ${range}: ${count} commit(s) do not reference the branch's WO (--strict)`);
  }
}

async function runCommitsRange(deps: CliDeps, range: string, strict: boolean): Promise<void> {
  const mismatchCount = await warnBranchMismatches(deps, range);
  const mode = detectProjectFileMode(deps.root);
  if (mode.kind === 'remote') {
    const check = await runRemoteCheckRange(deps.root, mode.file, range, { env: process.env });
    for (const entry of check.commits.filter((c) => !c.result.ok)) deps.stdout(formatEntry(entry));
    if (!check.ok) throw new CliError(`prdm check commits --range ${range}: policy violations found`);
    deps.stdout(`prdm check commits --range ${range}: ${check.commits.length} commit(s) ok`);
    failOnBranchMismatch(range, mismatchCount, strict);
    return;
  }

  const check = await checkCommitRange(deps.root, range);
  for (const entry of check.commits.filter((c) => !c.result.ok)) deps.stdout(formatEntry(entry));
  if (check.grandfatheredGrowthMessage) deps.stdout(check.grandfatheredGrowthMessage);
  if (check.orphanCommitsMessage) deps.stdout(check.orphanCommitsMessage);
  if (check.uncoveredPathsMessage) deps.stdout(check.uncoveredPathsMessage);
  if (check.notEnforcedMessage) deps.stdout(check.notEnforcedMessage);
  if (!check.ok) throw new CliError(`prdm check commits --range ${range}: policy violations found`);
  deps.stdout(`prdm check commits --range ${range}: ${check.commits.length} commit(s) ok`);
  failOnBranchMismatch(range, mismatchCount, strict);
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
    .option('--strict', 'fail (instead of warn) when a commit\'s Refs: does not include the WO declared by the branch name')
    .action((options: { range: string; strict?: boolean }) => runCommitsRange(deps, options.range, options.strict === true));
}
