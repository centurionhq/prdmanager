/**
 * `runLink` (SDD-010, WO-188): resolves `<org>/<project>` against a fake server exposing `GET
 * /api/v1/me` and the bare `POST /mcp`'s `list_projects` tool, then writes `.prdm.yaml` (version 2).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { parseRemoteProjectFile } from '@prdm/core';
import { makeTmpDir, removeDir } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CliError } from '../../src/errors.js';
import { saveCredentials } from '../../src/remote/credentials.js';
import { runLink } from '../../src/remote/link.js';

const PROJECTS = [{ id: 'prj_0123456789abcdef', name: 'Widgets', slug: 'widgets' }];

function buildFakeServer(orgSlug: string): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/v1/me', async () => ({ organization: { id: 'org_1', slug: orgSlug, name: orgSlug } }));

  app.post('/mcp', async (req, reply) => {
    const server = new McpServer({ name: 'fake', version: '0.0.0' });
    server.registerTool(
      'list_projects',
      { description: 'lists projects', inputSchema: {} },
      async () => {
        const data = { projects: PROJECTS };
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data };
      },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
  });

  return app;
}

describe('runLink (SDD-010, WO-188)', () => {
  let root: string;
  let xdgHome: string;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    root = makeTmpDir('prdm-link-root-');
    xdgHome = makeTmpDir('prdm-link-xdg-');
    app = buildFakeServer('acme');
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
    saveCredentials({ [baseUrl]: { token: 'prdm_pat_test' } }, { XDG_CONFIG_HOME: xdgHome });
  });

  afterEach(async () => {
    await app.close();
    removeDir(root);
    removeDir(xdgHome);
  });

  test('writes a version 2 .prdm.yaml with the server-resolved graph_project_id', async () => {
    const lines: string[] = [];
    const result = await runLink(root, { server: baseUrl, target: 'acme/widgets' }, { stdout: (l) => lines.push(l), env: { XDG_CONFIG_HOME: xdgHome } });

    expect(result.graphProjectId).toBe('prj_0123456789abcdef');
    const remoteFile = parseRemoteProjectFile(readFileSync(join(root, '.prdm.yaml'), 'utf8'));
    expect(remoteFile.project.id).toBe('prj_0123456789abcdef');
    expect(remoteFile.remote).toEqual({ server: baseUrl, org: 'acme', project: 'widgets', offlinePolicy: 'warn' });
    expect(lines.some((l) => l.includes('.prdm.yaml'))).toBe(true);
  });

  test('rejects when the token belongs to a different organization', async () => {
    await expect(runLink(root, { server: baseUrl, target: 'other-org/widgets' }, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome } })).rejects.toThrow(CliError);
  });

  test('rejects an unknown project slug', async () => {
    await expect(runLink(root, { server: baseUrl, target: 'acme/does-not-exist' }, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome } })).rejects.toThrow(CliError);
  });

  test('requires prior "prdm login" for this origin', async () => {
    const otherXdg = makeTmpDir('prdm-link-xdg2-');
    try {
      await expect(runLink(root, { server: baseUrl, target: 'acme/widgets' }, { stdout: () => undefined, env: { XDG_CONFIG_HOME: otherXdg } })).rejects.toThrow(CliError);
    } finally {
      removeDir(otherXdg);
    }
  });

  test('--import reads the local .prdm.yaml before it gets overwritten by the version 2 remote file', async () => {
    // No local .prdm.yaml exists in this fixture root at all: --import must fail clearly, and must
    // never get the chance to overwrite it with the remote link first.
    await expect(
      runLink(root, { server: baseUrl, target: 'acme/widgets', import: true }, { stdout: () => undefined, env: { XDG_CONFIG_HOME: xdgHome } }),
    ).rejects.toThrow(/\.prdm\.yaml not found/);
    expect(existsSync(join(root, '.prdm.yaml'))).toBe(false);
  });
});
