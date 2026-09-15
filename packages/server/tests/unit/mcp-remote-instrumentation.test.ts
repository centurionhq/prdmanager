/**
 * `instrumentMcpCalls` (SDD-010 "MCP remoto", WO-232): focused unit coverage of the tripwire on the
 * SDK's alternate `tool`/`resource`/`prompt` registration aliases — nothing in this codebase calls them
 * (confirmed by the full-text search this WO's review itself did), so the only way to prove the tripwire
 * actually fires is to call it directly here, since no real route ever will.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, test } from 'vitest';
import { instrumentMcpCalls } from '../../src/api/mcp-remote.js';

function buildServer(): McpServer {
  return new McpServer({ name: 'test', version: '0.0.0' });
}

describe('instrumentMcpCalls (WO-232)', () => {
  test('the tool()/resource()/prompt() aliases throw a clear error instead of silently bypassing instrumentation', async () => {
    const server = buildServer();
    instrumentMcpCalls(server, async () => undefined);

    const withAliases = server as unknown as { tool: (...args: unknown[]) => unknown; resource: (...args: unknown[]) => unknown; prompt: (...args: unknown[]) => unknown };
    expect(() => withAliases.tool('x', {}, async () => ({ content: [] }))).toThrow(/bypasses MCP audit/);
    expect(() => withAliases.resource('x', 'prdm://x', {}, async () => ({ contents: [] }))).toThrow(/bypasses MCP audit/);
    expect(() => withAliases.prompt('x', {}, async () => ({ messages: [] }))).toThrow(/bypasses MCP audit/);
  });

  test('a denied registerResource/registerPrompt call throws an McpError instead of returning a CallToolResult shape', async () => {
    const server = buildServer();
    const denial = { isError: true, content: [{ type: 'text' as const, text: '{}' }], structuredContent: { error: 'missing_scope', message: 'this token does not carry the mcp:read scope' } };
    instrumentMcpCalls(server, async () => denial);

    server.registerResource('r', 'prdm://r', { title: 'r' }, async () => ({ contents: [{ uri: 'prdm://r', text: 'never reached' }] }));
    server.registerPrompt('p', { title: 'p' }, async () => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'never reached' } }] }));

    const registeredResource = (server as unknown as { _registeredResources: Record<string, { readCallback: (...args: unknown[]) => unknown }> })._registeredResources['prdm://r']!;
    await expect(registeredResource.readCallback(new URL('prdm://r'), {})).rejects.toThrow(/mcp:read/);

    const registeredPrompt = (server as unknown as { _registeredPrompts: Record<string, { callback: (...args: unknown[]) => unknown }> })._registeredPrompts['p']!;
    await expect(registeredPrompt.callback({})).rejects.toThrow(/mcp:read/);
  });

  test('an allowed call (beforeCall resolves undefined) runs the real handler unchanged', async () => {
    const server = buildServer();
    instrumentMcpCalls(server, async () => undefined);

    let called = false;
    server.registerResource('r', 'prdm://r', { title: 'r' }, async (uri) => {
      called = true;
      return { contents: [{ uri: uri.href, text: 'ok' }] };
    });

    const registeredResource = (server as unknown as { _registeredResources: Record<string, { readCallback: (...args: unknown[]) => unknown }> })._registeredResources['prdm://r']!;
    const result = (await registeredResource.readCallback(new URL('prdm://r'), {})) as { contents: { text: string }[] };
    expect(called).toBe(true);
    expect(result.contents[0]!.text).toBe('ok');
  });
});
