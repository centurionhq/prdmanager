import { describe, expect, test } from 'vitest';
import { planMcpJson } from '../../src/scaffold/mcp-config.js';

describe('planMcpJson', () => {
  test('a fresh .mcp.json gets an npx --no-install prdm-graph entry (WO-024 finding 7)', () => {
    const rendered = planMcpJson(null);
    expect(rendered).not.toBeNull();
    const parsed = JSON.parse(rendered as string);
    expect(parsed.mcpServers['prdm-graph']).toEqual({ type: 'stdio', command: 'npx', args: ['--no-install', 'prdm-graph'] });
  });

  test('a bare "npx prdm-graph" entry (missing --no-install) is treated as stale and rewritten', () => {
    const existing = JSON.stringify({ mcpServers: { 'prdm-graph': { type: 'stdio', command: 'npx', args: ['prdm-graph'] } } });
    const rendered = planMcpJson(existing);
    expect(rendered).not.toBeNull();
    const parsed = JSON.parse(rendered as string);
    expect(parsed.mcpServers['prdm-graph'].args).toEqual(['--no-install', 'prdm-graph']);
  });

  test('is idempotent once the --no-install entry is present', () => {
    const existing = JSON.stringify({ mcpServers: { 'prdm-graph': { type: 'stdio', command: 'npx', args: ['--no-install', 'prdm-graph'] } } });
    expect(planMcpJson(existing)).toBeNull();
  });
});
