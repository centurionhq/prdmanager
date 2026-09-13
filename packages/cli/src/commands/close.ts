import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import { ACTOR_PATTERN, closeFeature, closureReadiness, type ClosureReadiness } from '@prdm/core';
import { CliError } from '../errors.js';
import { withContext, type CliDeps } from '../program.js';

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

function formatReadiness(readiness: ClosureReadiness): string {
  return readiness.checks.map((c) => `  ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`).join('\n');
}

interface CloseOptions {
  ack?: boolean;
  by?: string;
  json?: boolean;
}

/** `prdm close` is the sole entry point for PRD-002's human closure gate (ADR-002 D15); `--ack` is a deliberate, non-defaultable confirmation. */
async function runClose(deps: CliDeps, featureId: string, options: CloseOptions): Promise<void> {
  if (!options.ack) {
    throw new CliError(
      `closing ${featureId} requires an explicit human confirmation: re-run with --ack. This is the architect gate for PRD-002's lifecycle (SDD-002 "Ciclo de vida"); it is never automated.`,
    );
  }
  const by = resolveActor(options.by);

  await withContext(deps, async (ctx) => {
    const result = await closeFeature(ctx.engine, featureId, { by });
    if (options.json) deps.stdout(JSON.stringify(result, null, 2));
    else deps.stdout(`${result.featureId}: closed at ${result.closedAt} by ${result.closedBy}`);
  });
}

async function runReadiness(deps: CliDeps, featureId: string, options: { json?: boolean }): Promise<void> {
  await withContext(deps, async (ctx) => {
    const readiness = await closureReadiness(ctx.engine, featureId);
    if (options.json) deps.stdout(JSON.stringify(readiness, null, 2));
    else deps.stdout(`${readiness.featureId}: ${readiness.ready ? 'ready to close' : 'not ready'}\n${formatReadiness(readiness)}`);
  });
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('close')
    .description('close a feature once every blueprint architecting it is fully implemented (human gate, PRD-002 §3)')
    .argument('<featureId>', 'feature id (MRD/PRD/FR)')
    .option('--ack', 'confirm the architect gate explicitly (required)')
    .option('--by <actor>', 'actor closing it (agent:name or dev:name); defaults to $PRDM_ACTOR', parseActor)
    .option('--json', 'print the result as JSON')
    .action((featureId: string, options: CloseOptions) => runClose(deps, featureId, options));

  program
    .command('closure-readiness')
    .description('show which closure gate checks a feature still fails')
    .argument('<featureId>', 'feature id (MRD/PRD/FR)')
    .option('--json', 'print as JSON')
    .action((featureId: string, options: { json?: boolean }) => runReadiness(deps, featureId, options));
}
