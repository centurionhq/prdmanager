/**
 * `prdm login --server <url>` / `prdm logout [--server <url>]` (SDD-010, WO-187). Neither command
 * touches a local `.prdm.yaml`/project context at all (unlike almost every other command here) — both
 * register directly on `program`, never through `withContext`.
 */
import type { Command } from 'commander';
import type { CliDeps } from '../program.js';
import { askHidden } from '../remote/hidden-input.js';
import { runLogin, runLogout } from '../remote/login.js';

export function register(program: Command, deps: CliDeps): void {
  program
    .command('login')
    .description('store a personal API token for a prdm server, verified against GET /api/v1/me')
    .requiredOption('--server <url>', 'server origin, e.g. https://app.example.com')
    .action(async (opts: { server: string }) => {
      const token = await askHidden('Token (hidden): ');
      await runLogin(opts.server, token, { stdout: deps.stdout, askHidden });
    });

  program
    .command('logout')
    .description('remove the stored credential for a prdm server')
    .option('--server <url>', 'server origin; defaults to the only stored credential when there is exactly one')
    .action(async (opts: { server?: string }) => {
      await runLogout(opts.server, { stdout: deps.stdout });
    });
}
