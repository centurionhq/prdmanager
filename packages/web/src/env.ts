const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4600;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface WebBindOptions {
  host: string;
  port: number;
}

/**
 * Resolves `PRDM_WEB_HOST`/`PRDM_WEB_PORT` (defaults `127.0.0.1`/`4600`) and refuses a non-loopback host unless
 * `PRDM_WEB_ALLOW_REMOTE=1` is also set (SDD-005 "Seguridad"). Pulled out of `server.ts` (whose top-level `main()`
 * call would otherwise run as an import side effect the moment a test imported it — same reason
 * `packages/mcp/src/server.ts` and `packages/cli/src/index.ts` are never unit-imported in this repo) so it can be
 * unit tested in isolation.
 */
export function resolveWebBind(env: NodeJS.ProcessEnv): WebBindOptions {
  const host = env.PRDM_WEB_HOST ?? DEFAULT_HOST;
  const portRaw = env.PRDM_WEB_PORT ?? String(DEFAULT_PORT);
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== portRaw.trim()) {
    throw new Error(`PRDM_WEB_PORT must be an integer between 1 and 65535, got "${portRaw}"`);
  }
  const allowRemote = env.PRDM_WEB_ALLOW_REMOTE === '1';
  if (!LOOPBACK_HOSTS.has(host) && !allowRemote) {
    throw new Error(`PRDM_WEB_HOST=${host} is not a loopback address; set PRDM_WEB_ALLOW_REMOTE=1 to allow it`);
  }
  return { host, port };
}
