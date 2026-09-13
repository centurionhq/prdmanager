import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { testConfig } from '../helpers/db.js';
import { createFixtureRepo } from '../helpers/fixture.js';
import { removeDir } from '../helpers/tmp.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');

let root: string;
let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  root = createFixtureRepo();
  const config = testConfig(root);

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(PROJECT_ROOT, 'node_modules/tsx/dist/cli.mjs'), 'src/mcp/server.ts'],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PRDM_ROOT: root,
      NEO4J_URI: config.neo4j.uri,
      NEO4J_PASSWORD: config.neo4j.password,
      NEO4J_USERNAME: config.neo4j.username,
      NEO4J_DATABASE: config.neo4j.database,
    },
  });
  client = new Client({ name: 'e2e-client', version: '0.0.0' });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client?.close();
  if (root) removeDir(root);
});

describe('prdm-graph MCP server over stdio', () => {
  test('lists tools and calls get_feature_branch on PRD-001', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_feature_branch', 'get_work_order_context', 'claim_work_order']));

    const result = await client.callTool({ name: 'get_feature_branch', arguments: { id: 'PRD-001' } });
    const content = (result as { content: { type: string; text: string }[] }).content;
    expect(content[0]?.text).toContain('PRD-001');
  });
});
