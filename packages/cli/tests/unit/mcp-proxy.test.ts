/**
 * `runMcpProxy` (SDD-010 "MCP remoto", WO-189): refuses to run from inside a repository's own
 * `node_modules`, aborts (sending nothing) when `.prdm.yaml` is missing/not remote or points at a
 * different server than `PRDM_SERVER` expects, and otherwise relays JSON-RPC messages between a stdio
 * transport and a real Streamable HTTP server.
 */
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { LATEST_PROTOCOL_VERSION, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { renderRemoteProjectFile, type RemoteProjectFile } from '@prdm/core';
import { makeTmpDir, removeDir, writeFiles } from '@prdm/testkit';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { assertNotInRepoNodeModules, McpProxyAbortError, resolveMcpProxyTarget, runMcpProxy } from '../../src/remote/mcp-proxy.js';
import { saveCredentials } from '../../src/remote/credentials.js';

function remoteFile(server: string): RemoteProjectFile {
  return { version: 2, project: { id: 'prj_0123456789abcdef', name: 'widgets' }, remote: { server, org: 'acme', project: 'widgets', offlinePolicy: 'warn' } };
}

class FakeTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  readonly sent: JSONRPCMessage[] = [];
  started = false;

  async start(): Promise<void> {
    this.started = true;
  }
  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
  }
  async close(): Promise<void> {
    this.onclose?.();
  }
  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

describe('assertNotInRepoNodeModules (WO-189)', () => {
  test('allows cwd/binary outside the repository', () => {
    expect(() => assertNotInRepoNodeModules('/repo', { cwd: '/repo', binaryPath: '/usr/local/lib/node_modules/prdm/dist/index.js' })).not.toThrow();
  });

  test('refuses when cwd is inside the repo\'s own node_modules', () => {
    expect(() => assertNotInRepoNodeModules('/repo', { cwd: '/repo/node_modules/evil-package', binaryPath: '/repo/node_modules/.bin/prdm' })).toThrow(McpProxyAbortError);
  });

  test('refuses when only the resolved binary path is inside the repo\'s node_modules', () => {
    expect(() => assertNotInRepoNodeModules('/repo', { cwd: '/repo', binaryPath: '/repo/node_modules/.bin/prdm' })).toThrow(McpProxyAbortError);
  });
});

describe('resolveMcpProxyTarget (WO-189)', () => {
  let root: string;
  let xdgHome: string;

  beforeEach(() => {
    root = makeTmpDir('prdm-proxy-root-');
    xdgHome = makeTmpDir('prdm-proxy-xdg-');
  });

  afterEach(() => {
    removeDir(root);
    removeDir(xdgHome);
  });

  test('aborts when .prdm.yaml is missing', () => {
    expect(() => resolveMcpProxyTarget(root, { XDG_CONFIG_HOME: xdgHome })).toThrow(McpProxyAbortError);
  });

  test('aborts when .prdm.yaml is a local (version 1) project', () => {
    writeFiles(root, { '.prdm.yaml': 'version: 1\nproject:\n  id: prj_0123456789abcdef\n  name: x\n' });
    expect(() => resolveMcpProxyTarget(root, { XDG_CONFIG_HOME: xdgHome })).toThrow(McpProxyAbortError);
  });

  test('aborts when PRDM_SERVER disagrees with .prdm.yaml\'s remote.server', () => {
    writeFiles(root, { '.prdm.yaml': renderRemoteProjectFile(remoteFile('https://app.example.com')) });
    saveCredentials({ 'https://app.example.com': { token: 't' } }, { XDG_CONFIG_HOME: xdgHome });
    expect(() => resolveMcpProxyTarget(root, { XDG_CONFIG_HOME: xdgHome, PRDM_SERVER: 'https://other.example.com' })).toThrow(McpProxyAbortError);
  });

  test('aborts when there is no stored credential for the configured origin', () => {
    writeFiles(root, { '.prdm.yaml': renderRemoteProjectFile(remoteFile('https://app.example.com')) });
    expect(() => resolveMcpProxyTarget(root, { XDG_CONFIG_HOME: xdgHome })).toThrow(McpProxyAbortError);
  });

  test('resolves origin/graphProjectId/token when everything agrees', () => {
    writeFiles(root, { '.prdm.yaml': renderRemoteProjectFile(remoteFile('https://app.example.com')) });
    saveCredentials({ 'https://app.example.com': { token: 'prdm_pat_x' } }, { XDG_CONFIG_HOME: xdgHome });
    expect(resolveMcpProxyTarget(root, { XDG_CONFIG_HOME: xdgHome, PRDM_SERVER: 'https://app.example.com' })).toEqual({
      origin: 'https://app.example.com',
      graphProjectId: 'prj_0123456789abcdef',
      token: 'prdm_pat_x',
    });
  });
});

describe('runMcpProxy relay (WO-189)', () => {
  let root: string;
  let xdgHome: string;
  let app: FastifyInstance;
  let baseUrl: string;
  let seenAuthorization: string[];

  beforeEach(async () => {
    root = makeTmpDir('prdm-proxy-relay-root-');
    xdgHome = makeTmpDir('prdm-proxy-relay-xdg-');
    seenAuthorization = [];
    app = Fastify({ logger: false });
    app.post('/mcp/:graphProjectId', async (req, reply) => {
      seenAuthorization.push(req.headers.authorization ?? '');
      const server = new McpServer({ name: 'fake-remote', version: '0.0.0' });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      reply.hijack();
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
      reply.raw.on('close', () => {
        void transport.close();
        void server.close();
      });
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;

    writeFiles(root, { '.prdm.yaml': renderRemoteProjectFile(remoteFile(baseUrl)) });
    saveCredentials({ [baseUrl]: { token: 'prdm_pat_relay' } }, { XDG_CONFIG_HOME: xdgHome });
  });

  afterEach(async () => {
    await app.close();
    removeDir(root);
    removeDir(xdgHome);
  });

  test('relays an initialize request/response pair, with the stored credential as the Bearer header', async () => {
    const stdio = new FakeTransport();
    await runMcpProxy({
      cwd: root,
      root,
      env: { XDG_CONFIG_HOME: xdgHome },
      stderr: () => undefined,
      createStdioTransport: () => stdio,
    });

    stdio.receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'editor', version: '0.0.0' } },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(stdio.sent).toHaveLength(1);
    const response = stdio.sent[0] as { id: number; result?: { protocolVersion: string } };
    expect(response.id).toBe(1);
    expect(response.result?.protocolVersion).toBeDefined();
    expect(seenAuthorization).toEqual(['Bearer prdm_pat_relay']);
  });

  test('refuses to run from inside the repo\'s node_modules, without ever contacting the server', async () => {
    const nodeModulesCwd = join(root, 'node_modules', 'evil-package');
    let httpCreated = false;
    await expect(
      runMcpProxy({
        cwd: nodeModulesCwd,
        root,
        env: { XDG_CONFIG_HOME: xdgHome },
        stderr: () => undefined,
        createStdioTransport: () => new FakeTransport(),
        createHttpTransport: () => {
          httpCreated = true;
          return new FakeTransport();
        },
      }),
    ).rejects.toBeInstanceOf(McpProxyAbortError);
    expect(httpCreated).toBe(false);
    expect(seenAuthorization).toEqual([]);
  });

  test('aborts (sends nothing) when .prdm.yaml points at a different server than PRDM_SERVER expects', async () => {
    let httpCreated = false;
    await expect(
      runMcpProxy({
        cwd: root,
        root,
        env: { XDG_CONFIG_HOME: xdgHome, PRDM_SERVER: 'https://not-this-one.example.com' },
        stderr: () => undefined,
        createStdioTransport: () => new FakeTransport(),
        createHttpTransport: () => {
          httpCreated = true;
          return new FakeTransport();
        },
      }),
    ).rejects.toBeInstanceOf(McpProxyAbortError);
    expect(httpCreated).toBe(false);
    expect(seenAuthorization).toEqual([]);
  });

  test('aborts (sends nothing) when .prdm.yaml is missing entirely', async () => {
    const emptyRoot = makeTmpDir('prdm-proxy-empty-');
    try {
      let httpCreated = false;
      await expect(
        runMcpProxy({
          cwd: emptyRoot,
          root: emptyRoot,
          env: { XDG_CONFIG_HOME: xdgHome },
          stderr: () => undefined,
          createStdioTransport: () => new FakeTransport(),
          createHttpTransport: () => {
            httpCreated = true;
            return new FakeTransport();
          },
        }),
      ).rejects.toBeInstanceOf(McpProxyAbortError);
      expect(httpCreated).toBe(false);
    } finally {
      removeDir(emptyRoot);
    }
  });
});
