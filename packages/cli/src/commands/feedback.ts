import { stat, readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import {
  ACTOR_PATTERN,
  closeFeedback,
  createFeatureRequest,
  dismissFeedback,
  submitFeedback,
  triageText,
  type SubmitFeedbackResult,
  type TriageResult,
} from '@prdm/core';
import { formatSearchHits } from '../format.js';
import { CliError, messageOf } from '../errors.js';
import { withContext, type CliDeps } from '../program.js';
import { assertLocalMutationAllowed } from '../remote/guard.js';

const MAX_FEEDBACK_FILE_BYTES = 1024 * 1024;

interface AddOptions {
  text?: string;
  file?: string;
  source: string;
  customer?: string;
  title?: string;
  json?: boolean;
}

async function readFeedbackFile(path: string): Promise<string> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (err) {
    throw new CliError(`cannot read --file ${path}: ${messageOf(err)}`);
  }
  if (size > MAX_FEEDBACK_FILE_BYTES) throw new CliError(`--file exceeds ${MAX_FEEDBACK_FILE_BYTES} bytes`);
  return (await readFile(path, 'utf8')).trim();
}

async function resolveFeedbackText(options: AddOptions): Promise<string> {
  if (options.text && options.file) throw new CliError('provide either --text or --file, not both');
  if (options.text) return options.text;
  if (options.file) return readFeedbackFile(options.file);
  throw new CliError('either --text or --file is required');
}

function feedbackHint(result: SubmitFeedbackResult): string {
  const title = result.proposal?.title || result.id;
  const parent = result.proposal?.parentId ?? '<parent-feature-id>';
  return `hint: prdm fr create --title "${title}" --parent ${parent} --from-feedback ${result.id}`;
}

async function runAdd(deps: CliDeps, options: AddOptions): Promise<void> {
  assertLocalMutationAllowed(deps.root, 'feedback add');
  const text = await resolveFeedbackText(options);
  await withContext(deps, async (ctx) => {
    const result = await submitFeedback(ctx.engine, { text, source: options.source, customer: options.customer, title: options.title });
    if (options.json) {
      deps.stdout(JSON.stringify(result, null, 2));
      return;
    }
    deps.stdout(`${result.id}: linked to ${result.linkedTo.join(', ') || '(none)'} (${result.reason})`);
    if (result.candidates.length > 0) deps.stdout(formatSearchHits(result.candidates));
    if (result.proposal) deps.stdout(feedbackHint(result));
  });
}

function formatTriage(result: TriageResult): string {
  const lines = [
    `mentions: ${result.mentions.join(', ') || '(none)'}`,
    `reason: ${result.reason}`,
    `autoLinkTo: ${result.autoLinkTo.join(', ') || '(none)'}`,
  ];
  if (result.candidates.length > 0) lines.push(formatSearchHits(result.candidates));
  return lines.join('\n');
}

async function runTriage(deps: CliDeps, options: { text: string; json?: boolean }): Promise<void> {
  await withContext(deps, async (ctx) => {
    const result = await triageText(ctx.store, ctx.config, options.text);
    deps.stdout(options.json ? JSON.stringify(result, null, 2) : formatTriage(result));
  });
}

function parseActor(value: string): string {
  if (!ACTOR_PATTERN.test(value)) throw new InvalidArgumentError('actor must look like agent:name or dev:name');
  return value;
}

function resolveActor(as: string | undefined): string {
  const actor = as ?? process.env.PRDM_ACTOR;
  if (!actor) throw new CliError('an actor is required: pass --by or set PRDM_ACTOR');
  if (!ACTOR_PATTERN.test(actor)) throw new CliError(`invalid PRDM_ACTOR: ${actor} (expected agent:name or dev:name)`);
  return actor;
}

function collectRef(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface CloseOptions {
  reason: string;
  resolvedBy: string[];
  by?: string;
  json?: boolean;
}

async function runClose(deps: CliDeps, id: string, options: CloseOptions): Promise<void> {
  assertLocalMutationAllowed(deps.root, 'feedback close');
  const by = resolveActor(options.by);
  await withContext(deps, async (ctx) => {
    const result = await closeFeedback(ctx.engine, id, by, { reason: options.reason, resolvedBy: options.resolvedBy });
    if (options.json) {
      deps.stdout(JSON.stringify(result, null, 2));
      return;
    }
    const refs = result.resolvedBy.length > 0 ? ` (resolved by ${result.resolvedBy.join(', ')})` : '';
    deps.stdout(`${result.id}: closed at ${result.closedAt} by ${by}${refs}`);
  });
}

async function runDismiss(deps: CliDeps, id: string, options: { reason?: string; json?: boolean }): Promise<void> {
  assertLocalMutationAllowed(deps.root, 'feedback dismiss');
  await withContext(deps, async (ctx) => {
    const result = await dismissFeedback(ctx.engine, id, { reason: options.reason });
    if (options.json) {
      deps.stdout(JSON.stringify(result, null, 2));
      return;
    }
    deps.stdout(`${result.id}: dismissed${result.reason ? ` (${result.reason})` : ''}`);
  });
}

interface FrCreateOptions {
  title: string;
  parent: string;
  description?: string;
  fromFeedback?: string;
}

async function runFrCreate(deps: CliDeps, options: FrCreateOptions): Promise<void> {
  assertLocalMutationAllowed(deps.root, 'fr create');
  await withContext(deps, async (ctx) => {
    const result = await createFeatureRequest(ctx.engine, {
      title: options.title,
      description: options.description ?? options.title,
      parentId: options.parent,
      feedbackId: options.fromFeedback,
    });
    const from = result.feedbackId ? ` (from ${result.feedbackId})` : '';
    deps.stdout(`${result.id}: created under ${result.parentId}${from}`);
  });
}

export function register(program: Command, deps: CliDeps): void {
  const feedback = program.command('feedback').description('capture and triage customer feedback');

  feedback
    .command('add')
    .description('submit a piece of feedback and auto-link it to a feature')
    .requiredOption('--source <source>', 'feedback source (e.g. email, chat, slack)')
    .option('--text <text>', 'feedback text')
    .option('--file <path>', 'path to a file containing the feedback text (max 1 MB)')
    .option('--customer <name>', 'customer name')
    .option('--title <title>', 'override the generated title')
    .option('--json', 'print the result as JSON')
    .action((options: AddOptions) => runAdd(deps, options));

  feedback
    .command('triage')
    .description('preview link candidates for a piece of text without persisting anything')
    .requiredOption('--text <text>', 'text to triage')
    .option('--json', 'print the result as JSON')
    .action((options: { text: string; json?: boolean }) => runTriage(deps, options));

  feedback
    .command('close')
    .description('close a new or triaged feedback as resolved')
    .argument('<id>', 'feedback id')
    .requiredOption('--reason <text>', 'why the feedback is closed')
    .option('--resolved-by <ref>', 'resolving reference (WO, PR, ...); repeatable', collectRef, [])
    .option('--by <actor>', 'actor closing it (agent:name or dev:name); defaults to $PRDM_ACTOR', parseActor)
    .option('--json', 'print the result as JSON')
    .action((id: string, options: CloseOptions) => runClose(deps, id, options));

  feedback
    .command('dismiss')
    .description('dismiss a new or triaged feedback')
    .argument('<id>', 'feedback id')
    .option('--reason <text>', 'why the feedback is dismissed')
    .option('--json', 'print the result as JSON')
    .action((id: string, options: { reason?: string; json?: boolean }) => runDismiss(deps, id, options));

  const fr = program.command('fr').description('manage feature requests');

  fr.command('create')
    .description('create a feature request under an existing feature')
    .requiredOption('--title <title>', 'feature request title')
    .requiredOption('--parent <featureId>', 'parent feature id')
    .option('--description <text>', 'description (defaults to the title)')
    .option('--from-feedback <id>', 'originating feedback id')
    .action((options: FrCreateOptions) => runFrCreate(deps, options));
}
