/**
 * The `prdm-graph` MCP server entry `prdm init --mcp` merges into the target project's `.mcp.json`.
 * `--no-install` refuses to silently fetch and execute an arbitrary package from the registry the first time an
 * MCP client launches this entry (SDD-002 "Seguridad"): `prdm-graph` must already be installed locally.
 */
const PRDM_GRAPH_SERVER = {
  type: 'stdio',
  command: 'npx',
  args: ['--no-install', 'prdm-graph'],
} as const;

/**
 * The `prdm-remote` MCP server entry `prdm link --mcp` merges into the target project's `.mcp.json`
 * (SDD-010 "MCP remoto"/"CLI: credenciales y vinculación", WO-189): stdio, **no secrets** — the entry
 * itself never expands a token; `prdm mcp-proxy` resolves the credential itself, at runtime, from
 * `$XDG_CONFIG_HOME/prdm/credentials.json` for the origin `.prdm.yaml`'s `remote.server` names, and uses
 * the user's own globally-installed `prdm` (never `npx`, which a repo-controlled `package.json` could
 * quietly point at a malicious package of the same name).
 */
const PRDM_REMOTE_MCP_SERVER = {
  command: 'prdm',
  args: ['mcp-proxy'],
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function planMcpServerEntry(existing: string | null, key: string, entry: Record<string, unknown>): string | null {
  let root: Record<string, unknown> = {};
  if (existing !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (err) {
      throw new Error(`.mcp.json is not valid JSON: ${(err as Error).message}`);
    }
    if (!isPlainObject(parsed)) throw new Error('.mcp.json root must be a JSON object');
    root = parsed;
  }

  const servers = isPlainObject(root.mcpServers) ? root.mcpServers : {};
  if ('mcpServers' in root && !isPlainObject(root.mcpServers)) throw new Error('.mcp.json "mcpServers" must be an object');
  if (deepEqual(servers[key], entry)) return null;

  const merged = { ...root, mcpServers: { ...servers, [key]: entry } };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Merges (or creates) the `prdm-graph` entry in `.mcp.json`, preserving any other server the file already declares.
 * Returns `null` when the file already has an identical entry (idempotent re-run). Throws on malformed JSON or a
 * non-object root/`mcpServers`, per SDD-002 "Seguridad" (refuse rather than guess at a corrupt config).
 */
export function planMcpJson(existing: string | null): string | null {
  return planMcpServerEntry(existing, 'prdm-graph', PRDM_GRAPH_SERVER);
}

/** Same idempotent merge as {@link planMcpJson}, for `prdm link --mcp`'s `prdm-remote` entry. */
export function planRemoteMcpJson(existing: string | null): string | null {
  return planMcpServerEntry(existing, 'prdm-remote', PRDM_REMOTE_MCP_SERVER);
}
