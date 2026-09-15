/**
 * `prdm link <org>/<project> [--server <url>] [--import] [--mcp]` (SDD-010 "CLI: credenciales y
 * vinculación", WO-188). Never opens a Neo4j/database context (like `login`/`init`): it only calls the
 * remote server over HTTP (already-stored credentials) and writes local files.
 */
import type { Command } from 'commander';
import type { OfflinePolicy } from '@prdm/core';
import { CliError } from '../errors.js';
import type { CliDeps } from '../program.js';
import { runLink } from '../remote/link.js';

export interface LinkCliOptions {
  server: string;
  import?: boolean;
  mcp?: boolean;
  offlinePolicy: string;
}

function parseOfflinePolicyOption(value: string): OfflinePolicy {
  if (value === 'warn' || value === 'block') return value;
  throw new CliError(`--offline-policy must be "warn" or "block", got "${value}"`);
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('link')
    .description('link this repository to a remote prdm project (SaaS)')
    .argument('<target>', '"<org>/<project>" on the remote server')
    .requiredOption('--server <url>', 'server origin, e.g. https://app.example.com')
    .option('--import', 'upload docs/, .prdm.yaml and .prdm/baseline.json to the (empty) remote project')
    .option('--mcp', 'add the prdm-remote stdio proxy entry to .mcp.json')
    .option('--offline-policy <warn|block>', 'policy hooks fall back to when the governance cache is stale/missing', 'warn')
    .action(async (target: string, options: LinkCliOptions) => {
      await runLink(
        deps.root,
        { target, server: options.server, mcp: options.mcp, import: options.import, offlinePolicy: parseOfflinePolicyOption(options.offlinePolicy) },
        { stdout: deps.stdout },
      );
    });
}
