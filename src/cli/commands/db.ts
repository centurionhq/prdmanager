import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Command } from 'commander';
import { formatRefreshReport } from '../format.js';
import { CliError } from '../errors.js';
import { withContext, type CliDeps } from '../program.js';

const execFileAsync = promisify(execFile);

async function runUp(deps: CliDeps): Promise<void> {
  const { stdout, stderr } = await execFileAsync('docker', ['compose', 'up', '-d', 'neo4j'], { cwd: deps.root });
  if (stdout.trim()) deps.stdout(stdout.trimEnd());
  if (stderr.trim()) deps.stderr(stderr.trimEnd());
}

async function runStatus(deps: CliDeps): Promise<void> {
  await withContext(deps, async (ctx) => {
    await ctx.store.verify();
    const graph = await ctx.store.fullGraph();
    deps.stdout(`uri: ${ctx.config.neo4j.uri}`);
    deps.stdout(`database: ${ctx.config.neo4j.database}`);
    deps.stdout(`nodes: ${graph.nodes.length}`);
    deps.stdout(`edges: ${graph.edges.length}`);
  });
}

async function runReset(deps: CliDeps, options: { yes?: boolean }): Promise<void> {
  if (!options.yes) throw new CliError('refusing to reset the database without --yes');
  await withContext(deps, async (ctx) => {
    await ctx.store.clear();
    await ctx.store.migrate();
    const report = await ctx.engine.refresh();
    deps.stdout(formatRefreshReport(report));
  });
}

export function register(program: Command, deps: CliDeps): void {
  const db = program.command('db').description('manage the local Neo4j graph store');

  db.command('up').description('start the Neo4j docker compose service').action(() => runUp(deps));

  db.command('migrate')
    .description('apply graph schema migrations')
    .action(async () => {
      await withContext(deps, async (ctx) => {
        await ctx.store.migrate();
        deps.stdout('migrations applied');
      });
    });

  db.command('status')
    .description('check connectivity and report graph size')
    .action(() => runStatus(deps));

  db.command('reset')
    .description('clear the graph and rebuild it from the documents')
    .option('--yes', 'confirm the destructive reset')
    .action((options: { yes?: boolean }) => runReset(deps, options));
}
