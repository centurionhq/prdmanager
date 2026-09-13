import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Command } from 'commander';
import { formatRefreshReport } from '../format.js';
import { CliError } from '../errors.js';
import { withContext, type CliDeps } from '../program.js';

const execFileAsync = promisify(execFile);

async function runUp(deps: CliDeps): Promise<void> {
  const { stdout, stderr } = await execFileAsync('docker', ['compose', 'up', '-d', 'neo4j', 'neo4j-proxy'], { cwd: deps.root });
  if (stdout.trim()) deps.stdout(stdout.trimEnd());
  if (stderr.trim()) deps.stderr(stderr.trimEnd());
}

async function runMigrate(deps: CliDeps): Promise<void> {
  await withContext(
    deps,
    async (ctx) => {
      const status = await ctx.db.migrate();
      deps.stdout(`schema version: ${status.current} (expected ${status.expected})`);
      deps.stdout('migrations applied');
    },
    { requireSchema: false, skipRecover: true },
  );
}

async function runStatus(deps: CliDeps): Promise<void> {
  await withContext(
    deps,
    async (ctx) => {
      await ctx.db.verify();
      const schema = await ctx.db.schemaStatus();
      const projects = await ctx.db.listProjects();
      deps.stdout(`uri: ${ctx.config.neo4j.uri}`);
      deps.stdout(`database: ${ctx.config.neo4j.database}`);
      deps.stdout(`schema version: ${schema.current} (expected ${schema.expected})`);
      if (schema.pending.length > 0) deps.stdout(`pending migrations: ${schema.pending.map((m) => `${m.version}:${m.name}`).join(', ')}`);
      deps.stdout(`projects: ${projects.length}`);
      for (const p of projects) deps.stdout(`  ${p.id} (${p.name}): ${p.nodeCount} node(s), root=${p.rootFingerprint}`);
    },
    { requireSchema: false, skipRecover: true },
  );
}

async function runReset(deps: CliDeps, options: { yes?: boolean }): Promise<void> {
  if (!options.yes) throw new CliError('refusing to reset the database without --yes');
  await withContext(deps, async (ctx) => {
    await ctx.store.clear();
    const report = await ctx.engine.refresh();
    deps.stdout(formatRefreshReport(report));
  });
}

async function runDoctor(deps: CliDeps): Promise<void> {
  await withContext(
    deps,
    async (ctx) => {
      const orphans = await ctx.db.orphanCounts();
      const broken = orphans.filter((o) => o.count > 0);
      for (const o of orphans) deps.stdout(`${o.label}: ${o.count} orphan(s) without project_id`);
      if (broken.length > 0) throw new CliError(`found ${broken.reduce((s, o) => s + o.count, 0)} node(s) without project_id; run \`prdm sync\` after fixing the migration`);
      deps.stdout('doctor: ok');
    },
    { skipRecover: true },
  );
}

export function register(program: Command, deps: CliDeps): void {
  const db = program.command('db').description('manage the local Neo4j graph store');

  db.command('up').description('start Neo4j and its localhost proxy (docker compose)').action(() => runUp(deps));

  db.command('migrate').description('apply graph schema migrations (destructive migrations require this explicit command)').action(() => runMigrate(deps));

  db.command('status').description('check connectivity, schema version and registered projects').action(() => runStatus(deps));

  db.command('reset')
    .description("clear this project's partition and rebuild it from the documents")
    .option('--yes', 'confirm the destructive reset')
    .action((options: { yes?: boolean }) => runReset(deps, options));

  db.command('doctor').description('verify every Node/CodeRef/Commit/Actor carries a project_id').action(() => runDoctor(deps));
}
