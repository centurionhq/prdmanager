/**
 * `prdm mcp-proxy` (SDD-010 "MCP remoto", WO-189). Never opens a Neo4j/database context — it only relays
 * stdio JSON-RPC to the remote server's `/mcp/:graphProjectId`.
 */
import type { Command } from 'commander';
import { CliError, messageOf } from '../errors.js';
import { runMcpProxy } from '../remote/mcp-proxy.js';
import type { CliDeps } from '../program.js';

export function register(program: Command, deps: CliDeps): void {
  program
    .command('mcp-proxy')
    .description('stdio-to-Streamable-HTTP relay to this repository\'s linked remote MCP project')
    .action(async () => {
      try {
        await runMcpProxy({ cwd: process.cwd(), binaryPath: process.argv[1], root: deps.root, env: process.env, stderr: deps.stderr });
      } catch (err) {
        throw new CliError(messageOf(err));
      }
    });
}
