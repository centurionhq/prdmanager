/**
 * `prdm mcp-proxy` (SDD-010 "MCP remoto", WO-189): a stdio-to-Streamable-HTTP relay. `.mcp.json` (WO-188's
 * `--mcp`) only ever names `{"command": "prdm", "args": ["mcp-proxy"]}` — no server, project or token —
 * so every one of those has to be resolved here, at runtime, from the *local* `.prdm.yaml` (which server
 * and project this repo was `prdm link`ed to) and the CLI's own stored credentials (WO-187, the token for
 * that *exact* origin). Two conditions abort before anything is ever sent, both treated identically to a
 * hard failure rather than a silent fallback to some other server/project/credential:
 *
 *  - Invoked from inside a *repository's own* `node_modules` (its `cwd`, or the resolved path of the
 *    binary actually running) — a dependency that repo controls must never be able to run as this proxy
 *    and inherit the operator's real credentials. Deliberately scoped to "inside `<root>/node_modules`",
 *    not "any `node_modules` anywhere on disk": `prdm` itself is normally installed globally, which on
 *    most package managers *also* lives under a `node_modules` directory (e.g.
 *    `~/.nvm/versions/node/vX/lib/node_modules/prdm`) — a bare path-segment check would refuse to run at
 *    all for a completely normal global install.
 *  - `.prdm.yaml` has no `remote` section (not a remote-linked repo at all), or (when the caller supplies
 *    an explicit expectation via `PRDM_SERVER`, the same env var WO-190 makes mandatory in CI) that
 *    section's `remote.server` doesn't match it — never "pick one and hope".
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { loadRemoteProjectConfig } from '@prdm/core';
import { loadCredentials } from './credentials.js';
import { parseServerUrl } from './server-url.js';

export class McpProxyAbortError extends Error {}

/** `true` when `candidate` (resolved) is `<root>/node_modules` or lives inside it. */
function isWithinRepoNodeModules(root: string, candidate: string): boolean {
  const nodeModules = resolve(root, 'node_modules');
  const rel = relative(nodeModules, resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Aborts (never sends anything) when `cwd` or `binaryPath` resolves inside `<root>/node_modules`. */
export function assertNotInRepoNodeModules(root: string, paths: { cwd: string; binaryPath?: string }): void {
  const candidates = [paths.cwd, ...(paths.binaryPath ? [paths.binaryPath] : [])];
  for (const candidate of candidates) {
    if (isWithinRepoNodeModules(root, candidate)) {
      throw new McpProxyAbortError(
        `refusing to run prdm mcp-proxy from inside ${resolve(root, 'node_modules')}: a repository's own dependency must never run as this proxy with your credentials`,
      );
    }
  }
}

export interface McpProxyTarget {
  origin: string;
  graphProjectId: string;
  token: string;
}

/** Resolves the server, project and credential this proxy forwards to, or throws `McpProxyAbortError`
 * without ever making a network call. */
export function resolveMcpProxyTarget(root: string, env: NodeJS.ProcessEnv): McpProxyTarget {
  const remote = loadRemoteProjectConfig(root);
  if (!remote) {
    throw new McpProxyAbortError('.prdm.yaml has no "remote" section (this repository is not linked to a remote project); run "prdm link" first');
  }

  const configuredOrigin = parseServerUrl(remote.remote.server).origin;
  const expectedServer = env.PRDM_SERVER;
  if (expectedServer) {
    const expectedOrigin = parseServerUrl(expectedServer).origin;
    if (expectedOrigin !== configuredOrigin) {
      throw new McpProxyAbortError(`.prdm.yaml points to ${configuredOrigin}, but PRDM_SERVER is ${expectedOrigin}; refusing to guess which one is correct`);
    }
  }

  const credentials = loadCredentials(env);
  const credential = credentials[configuredOrigin];
  if (!credential) throw new McpProxyAbortError(`not logged in to ${configuredOrigin}; run "prdm login --server ${configuredOrigin}" first`);

  return { origin: configuredOrigin, graphProjectId: remote.project.id, token: credential.token };
}

export interface McpProxyDeps {
  cwd: string;
  /** The path of the binary actually running (e.g. `process.argv[1]`); omitted in tests that don't care. */
  binaryPath?: string;
  root: string;
  env: NodeJS.ProcessEnv;
  stderr: (line: string) => void;
  /** Injectable for tests — defaults to a real `StdioServerTransport`. */
  createStdioTransport?: () => Transport;
  /** Injectable for tests — defaults to a real `StreamableHTTPClientTransport` against `target`. */
  createHttpTransport?: (target: McpProxyTarget) => Transport;
}

function defaultHttpTransport(target: McpProxyTarget): Transport {
  return new StreamableHTTPClientTransport(new URL(`/mcp/${target.graphProjectId}`, target.origin), {
    requestInit: { headers: { authorization: `Bearer ${target.token}` } },
  });
}

/** Wires two `Transport`s together: every message either side receives is forwarded, unmodified, to the
 * other. Neither side needs to know it's talking to a proxy rather than the real peer. */
function relay(a: Transport, b: Transport, onError: (err: unknown) => void): void {
  a.onmessage = (message: JSONRPCMessage) => {
    b.send(message).catch(onError);
  };
  b.onmessage = (message: JSONRPCMessage) => {
    a.send(message).catch(onError);
  };
}

/** Starts the relay and resolves once both transports have connected; never resolves before that (a
 * caller awaiting this knows nothing has silently failed to start). Runs until either side closes. */
export async function runMcpProxy(deps: McpProxyDeps): Promise<void> {
  assertNotInRepoNodeModules(deps.root, { cwd: deps.cwd, binaryPath: deps.binaryPath });
  const target = resolveMcpProxyTarget(deps.root, deps.env);

  const stdio = deps.createStdioTransport ? deps.createStdioTransport() : new StdioServerTransport();
  const http = deps.createHttpTransport ? deps.createHttpTransport(target) : defaultHttpTransport(target);

  let closed = false;
  const closeBoth = (): void => {
    if (closed) return;
    closed = true;
    void Promise.allSettled([stdio.close(), http.close()]);
  };

  const onError = (err: unknown): void => deps.stderr(`prdm mcp-proxy: ${err instanceof Error ? err.message : String(err)}`);
  relay(stdio, http, onError);
  stdio.onerror = onError;
  http.onerror = onError;
  stdio.onclose = closeBoth;
  http.onclose = closeBoth;

  await http.start();
  await stdio.start();
}
