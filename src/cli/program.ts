import { Command, CommanderError } from 'commander';
import { loadConfig, type PrdmConfig } from '../config.js';
import { Engine } from '../engine.js';
import { Neo4jGraphStore } from '../graph/store.js';
import type { GraphStore } from '../graph/types.js';
import { register as registerArtifactCommands } from './commands/artifacts.js';
import { register as registerDbCommands } from './commands/db.js';
import { register as registerFeedbackCommands } from './commands/feedback.js';
import { register as registerGraphCommands } from './commands/graph.js';
import { register as registerMetricsCommands } from './commands/metrics.js';
import { register as registerParserCommands } from './commands/parser.js';
import { register as registerSyncCommands } from './commands/sync.js';
import { register as registerWorkOrderCommands } from './commands/workorders.js';
import { CliError, messageOf } from './errors.js';

export interface CliContext {
  config: PrdmConfig;
  store: GraphStore;
  engine: Engine;
  close(): Promise<void>;
}

export interface CliDeps {
  root: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  openContext?: (root: string) => Promise<CliContext>;
}

async function defaultOpenContext(root: string): Promise<CliContext> {
  const config = loadConfig(root);
  const store = Neo4jGraphStore.connect(config.neo4j);
  const engine = new Engine(config, store);
  return { config, store, engine, close: () => store.close() };
}

export function openContextFor(deps: CliDeps): (root: string) => Promise<CliContext> {
  return deps.openContext ?? defaultOpenContext;
}

/** Opens a CLI context, runs `fn`, and always closes it — commands should not manage lifecycle themselves. */
export async function withContext<T>(deps: CliDeps, fn: (ctx: CliContext) => Promise<T>): Promise<T> {
  const ctx = await openContextFor(deps)(deps.root);
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}

const REGISTRARS = [
  registerDbCommands,
  registerParserCommands,
  registerGraphCommands,
  registerSyncCommands,
  registerMetricsCommands,
  registerWorkOrderCommands,
  registerFeedbackCommands,
  registerArtifactCommands,
];

export function createProgram(deps: CliDeps): Command {
  const program = new Command();
  program
    .name('prdm')
    .description('Product & Context Graph Engine CLI (PRD-001)')
    .exitOverride()
    .configureOutput({
      writeOut: (str) => deps.stdout(str),
      writeErr: (str) => deps.stderr(str),
    });

  for (const registrar of REGISTRARS) registrar(program, deps);

  return program;
}

function handleCliError(err: unknown, deps: CliDeps): number {
  if (err instanceof CommanderError) return err.exitCode;
  deps.stderr(messageOf(err));
  return err instanceof CliError ? err.exitCode : 1;
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const program = createProgram(deps);
  try {
    await program.parseAsync(argv as string[]);
    return 0;
  } catch (err) {
    return handleCliError(err, deps);
  }
}
