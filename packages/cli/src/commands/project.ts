import type { Command } from 'commander';
import { CliError } from '../errors.js';
import { withContext, type CliDeps } from '../program.js';

async function runList(deps: CliDeps): Promise<void> {
  await withContext(deps, async (ctx) => {
    const projects = await ctx.db.listProjects();
    if (projects.length === 0) {
      deps.stdout('no projects registered yet (run `prdm sync` to register this one)');
      return;
    }
    for (const p of projects) {
      const mine = p.id === ctx.config.project.id ? ' (this checkout)' : '';
      deps.stdout(`${p.id} ${p.name} nodes=${p.nodeCount} root=${p.rootFingerprint}${mine}`);
    }
  });
}

async function runClaim(deps: CliDeps): Promise<void> {
  await withContext(deps, async (ctx) => {
    await ctx.db.claimProject(ctx.config.project);
    deps.stdout(`claimed ${ctx.config.project.id} for ${ctx.config.project.root}`);
  });
}

async function runRemove(deps: CliDeps, id: string, options: { yes?: boolean }): Promise<void> {
  if (!options.yes) throw new CliError('refusing to remove a project without --yes');
  await withContext(deps, async (ctx) => {
    await ctx.db.dropProject(id);
    deps.stdout(`removed ${id}`);
  });
}

export function register(program: Command, deps: CliDeps): void {
  const project = program.command('project').description('manage projects registered in the shared Neo4j instance');

  project.command('list').description('list every project and its partition size').action(() => runList(deps));

  project
    .command('claim')
    .description('reassign this project\'s partition to the current checkout root (SDD-002 "Proyecto activo")')
    .action(() => runClaim(deps));

  project
    .command('remove <id>')
    .description('permanently delete a project and its partition')
    .option('--yes', 'confirm the destructive removal')
    .action((id: string, options: { yes?: boolean }) => runRemove(deps, id, options));
}
