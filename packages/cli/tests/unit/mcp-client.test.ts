/**
 * `resolveRemoteProject` (SDD-010 "CLI: credenciales y vinculación", WO-188/WO-236): the bare `POST
 * /mcp`'s `list_projects` call is the live MCP data channel `prdm link` uses to resolve a project — it
 * must never follow a redirect, same as every other credentialed fetch in this codebase (login, sync,
 * import, policy-docs).
 */
import { createServer, type Server } from 'node:http';
import { describe, expect, test } from 'vitest';
import { resolveRemoteProject } from '../../src/remote/mcp-client.js';

describe('resolveRemoteProject (WO-236)', () => {
  test('a redirect response from the live MCP data channel is rejected, never followed (real HTTP server)', async () => {
    let targetHit = false;
    const server: Server = createServer((req, res) => {
      if (req.url === '/api/v1/me') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ organization: { id: 'org_1', slug: 'acme', name: 'Acme' } }));
        return;
      }
      if (req.url === '/mcp') {
        res.writeHead(302, { location: '/evil' });
        res.end();
        return;
      }
      if (req.url === '/evil') {
        targetHit = true;
        res.writeHead(200);
        res.end('should never be reached');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await expect(resolveRemoteProject(baseUrl, 't', 'acme', 'widgets')).rejects.toThrow();
      expect(targetHit).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
