import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** Repo root of this worktree (packages/cli/tests/e2e -> ../../../..). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const CLI_DIST = resolve(REPO_ROOT, 'packages/cli/dist/index.js');
export const MCP_DIST = resolve(REPO_ROOT, 'packages/mcp/dist/server.js');

/** The throwaway, tmpfs-backed Neo4j instance this worktree's e2e/integration tests share (never the dev instance). */
export const NEO4J_TEST_URI = process.env.NEO4J_TEST_URI ?? 'neo4j://127.0.0.1:7689';

/** Fails fast with a clear instruction instead of a confusing MODULE_NOT_FOUND deep in a child process. */
export function assertBuilt(): void {
  const missing = [CLI_DIST, MCP_DIST].filter((path) => !statSync(path, { throwIfNoEntry: false }));
  if (missing.length > 0) {
    throw new Error(`e2e requires a build: run "npm run build" at the repo root first (missing ${missing.join(', ')})`);
  }
}

/** Reads NEO4J_PASSWORD straight from the worktree's .env, without ever logging it. */
export function readTestNeo4jPassword(): string {
  const envPath = join(REPO_ROOT, '.env');
  const content = readFileSync(envPath, 'utf8');
  const match = /^NEO4J_PASSWORD=(.+)$/m.exec(content);
  if (!match?.[1]) throw new Error('.env has no NEO4J_PASSWORD line');
  const value = match[1].trim();
  if (!value) throw new Error('.env NEO4J_PASSWORD is empty');
  return value;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawns the real, built `prdm` binary as a child process (never the in-process runCli). */
export function runCli(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): RunResult {
  const result = spawnSync(process.execPath, [CLI_DIST, ...args], { cwd, env, encoding: 'utf8' });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const GIT_IDENTITY = ['-c', 'user.name=prdm-e2e', '-c', 'user.email=prdm-e2e@example.com', '-c', 'commit.gpgsign=false'];

/** Runs `git` and reports its exit code/output instead of throwing, so rejected commits can be asserted on. */
export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): RunResult {
  const result = spawnSync('git', [...GIT_IDENTITY, ...args], { cwd, env, encoding: 'utf8' });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function gitInit(cwd: string): void {
  const result = git(cwd, ['init', '-q', '-b', 'main']);
  if (result.code !== 0) throw new Error(`git init failed: ${result.stderr}`);
}

export function headSha(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']).stdout.trim();
}

/** Deterministic hash of every file's relative path and content below `root` (`.git` excluded), for idempotency checks. */
export function hashTree(root: string): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(root);
  files.sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(root, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export interface McpSession {
  client: Client;
  transport: StdioClientTransport;
  close(): Promise<void>;
}

/** Spawns the real, built prdm-graph MCP server over stdio, scoped to `root` via PRDM_ROOT. */
export async function connectMcp(root: string, env: NodeJS.ProcessEnv = process.env): Promise<McpSession> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_DIST],
    cwd: REPO_ROOT,
    env: { ...env, PRDM_ROOT: root },
  });
  const client = new Client({ name: 'prdm-e2e', version: '0.0.0' });
  await client.connect(transport);
  return {
    client,
    transport,
    close: async () => {
      await client.close();
    },
  };
}

export interface ToolTextResult {
  isError?: boolean;
  text: string;
  data: Record<string, unknown>;
}

/** Unwraps an MCP `callTool` result's single text content block into both the raw text and its parsed JSON. */
export function toolResult(result: unknown): ToolTextResult {
  const typed = result as { isError?: boolean; content: { type: string; text: string }[] };
  const text = typed.content[0]?.text ?? '';
  return { isError: typed.isError, text, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

export function withoutKeys(env: NodeJS.ProcessEnv, keys: string[]): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const key of keys) delete copy[key];
  return copy;
}
