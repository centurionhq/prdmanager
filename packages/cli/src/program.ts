import { Command, CommanderError } from 'commander';
import { Engine, loadConfig, Neo4jGraphDatabase, type GraphDatabase, type GraphStore, type PrdmConfig } from '@prdm/core';
import { register as registerArtifactCommands } from './commands/artifacts.js';
import { register as registerCheckCommands } from './commands/check.js';
import { register as registerDbCommands } from './commands/db.js';
import { register as registerFeedbackCommands } from './commands/feedback.js';
import { register as registerGraphCommands } from './commands/graph.js';
import { register as registerHooksCommands } from './commands/hooks.js';
import { register as registerInitCommands } from './commands/init.js';
import { register as registerMetricsCommands } from './commands/metrics.js';
import { register as registerMigrateCommands } from './commands/migrate.js';
import { register as registerParserCommands } from './commands/parser.js';
import { register as registerProjectCommands } from './commands/project.js';
import { register as registerSyncCommands } from './commands/sync.js';
import { register as registerWorkOrderCommands } from './commands/workorders.js';
import { CliError, messageOf } from './errors.js';

export interface CliContext {
  config: PrdmConfig;
  db: GraphDatabase;
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
  const db = Neo4jGraphDatabase.connect(config.neo4j);
  const store = db.forProject(config.project);
  const engine = new Engine(config, store);
  return { config, db, store, engine, close: () => db.close() };
}

export function openContextFor(deps: CliDeps): (root: string) => Promise<CliContext> {
  return deps.openContext ?? defaultOpenContext;
}

/**
 * Opens a CLI context, runs `fn`, and always closes it — commands should not manage lifecycle themselves.
 * Every command verifies the schema version first (ADR-002 D3: clients refuse to operate on an unknown or
 * outdated schema) except the ones that manage the schema itself (`db migrate`, `db status`), which pass
 * `requireSchema: false`.
 */
export async function withContext<T>(deps: CliDeps, fn: (ctx: CliContext) => Promise<T>, options: { requireSchema?: boolean } = {}): Promise<T> {
  const ctx = await openContextFor(deps)(deps.root);
  try {
    if (options.requireSchema !== false) await ctx.db.assertSchemaCurrent();
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}

/** `init` and `check commit-msg`/`check commits` never call {@link withContext}: they run without Neo4j or `NEO4J_PASSWORD` (SDD-002 "Proyecto activo" / "Ciclo de vida"). */
const REGISTRARS = [
  registerDbCommands,
  registerProjectCommands,
  registerParserCommands,
  registerGraphCommands,
  registerSyncCommands,
  registerMetricsCommands,
  registerMigrateCommands,
  registerWorkOrderCommands,
  registerFeedbackCommands,
  registerArtifactCommands,
  registerInitCommands,
  registerHooksCommands,
  registerCheckCommands,
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
