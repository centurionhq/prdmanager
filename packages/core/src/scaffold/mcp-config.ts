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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merges (or creates) the `prdm-graph` entry in `.mcp.json`, preserving any other server the file already declares.
 * Returns `null` when the file already has an identical entry (idempotent re-run). Throws on malformed JSON or a
 * non-object root/`mcpServers`, per SDD-002 "Seguridad" (refuse rather than guess at a corrupt config).
 */
export function planMcpJson(existing: string | null): string | null {
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
  if (deepEqual(servers['prdm-graph'], PRDM_GRAPH_SERVER)) return null;

  const merged = { ...root, mcpServers: { ...servers, 'prdm-graph': PRDM_GRAPH_SERVER } };
  return `${JSON.stringify(merged, null, 2)}\n`;
}
