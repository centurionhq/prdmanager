import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import { parseProjectFile } from './project/file.js';
import {
  DEFAULT_AUTHORING,
  DEFAULT_GIT,
  DEFAULT_LIFECYCLE,
  type AuthoringSettings,
  type FolderMap,
  type GitSettings,
  type LifecycleSettings,
  type ProjectRef,
} from './project/types.js';
import { foldersForDocsDir } from './scaffold/folders.js';

const MANDATORY_IGNORE = ['node_modules/**', '.git/**', 'dist/**', 'coverage/**', '.docker/**', '.prdm/**'];

const fileSchema = z.object({
  docsDir: z.string().min(1).default('docs'),
  ignore: z.array(z.string().min(1)).default([]),
  gitMaxCommits: z.number().int().positive().max(100_000).default(500),
  triage: z
    .object({
      autoLinkMinScore: z.number().positive().default(0.5),
      autoLinkMargin: z.number().min(1).default(1.05),
      maxCandidates: z.number().int().min(1).max(50).default(5),
      minMatchedTerms: z.number().int().min(0).default(2),
    })
    .prefault({}),
});

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

export interface PrdmConfig {
  root: string;
  project: ProjectRef;
  folders: FolderMap;
  git: GitSettings;
  lifecycle: LifecycleSettings;
  authoring: AuthoringSettings;
  docsDir: string;
  ignore: string[];
  gitMaxCommits: number;
  triage: { autoLinkMinScore: number; autoLinkMargin: number; maxCandidates: number; minMatchedTerms: number };
  neo4j: Neo4jConfig;
}

export function loadConfig(root: string, env: NodeJS.ProcessEnv = process.env): PrdmConfig {
  const rootAbs = resolve(root);
  const dotenvPath = join(rootAbs, '.env');
  const dotenv = existsSync(dotenvPath) ? parseDotenv(readFileSync(dotenvPath)) : {};
  const get = (key: string): string | undefined => env[key] ?? dotenv[key];

  const password = get('NEO4J_PASSWORD');
  if (!password) throw new Error('NEO4J_PASSWORD is not set (define it in .env or the environment)');

  const uri = get('NEO4J_URI') ?? 'neo4j://127.0.0.1:7687';
  // `PRDM_ALLOW_REMOTE_NEO4J` is read only from the real process environment: a repository's `.env` must never be
  // able to self-authorize a remote host. Even with that real opt-in, a `NEO4J_URI` sourced from `.env` combined
  // with a `NEO4J_PASSWORD` sourced from the real environment is refused, since that combination would let an
  // attacker-controlled `.env` redirect a genuine operator-supplied secret to an arbitrary host.
  const allowRemote = env.PRDM_ALLOW_REMOTE_NEO4J === '1';
  assertLocalNeo4j(uri, allowRemote, { uriFromRealEnv: env.NEO4J_URI !== undefined, passwordFromRealEnv: env.NEO4J_PASSWORD !== undefined });
  const neo4j: Neo4jConfig = { uri, username: get('NEO4J_USERNAME') ?? 'neo4j', password, database: get('NEO4J_DATABASE') ?? 'neo4j' };

  // `.prdm.yaml` (WO-017) takes priority over the legacy `prdm.config.json`: when both exist, the JSON file is
  // ignored outright (never merged), so a stale file left over from `prdm init --adopt` cannot resurrect settings.
  const projectFilePath = join(rootAbs, '.prdm.yaml');
  if (existsSync(projectFilePath)) return fromProjectFile(rootAbs, readFileSync(projectFilePath, 'utf8'), neo4j);
  return fromLegacyConfig(rootAbs, neo4j);
}

function fromProjectFile(rootAbs: string, src: string, neo4j: Neo4jConfig): PrdmConfig {
  const file = parseProjectFile(src);
  const root = existsSync(rootAbs) ? realpathSync(rootAbs) : rootAbs;
  return {
    root,
    project: { id: file.project.id, name: file.project.name, root },
    folders: file.folders,
    git: file.git,
    lifecycle: file.lifecycle,
    authoring: file.authoring,
    docsDir: file.docsDir,
    ignore: [...new Set([...MANDATORY_IGNORE, ...file.ignore])],
    gitMaxCommits: file.git.maxCommits,
    triage: file.triage,
    neo4j,
  };
}

function fromLegacyConfig(rootAbs: string, neo4j: Neo4jConfig): PrdmConfig {
  const file = readConfigFile(join(rootAbs, 'prdm.config.json'));
  return {
    root: rootAbs,
    project: legacyProject(rootAbs),
    folders: foldersForDocsDir(file.docsDir),
    git: { ...DEFAULT_GIT, maxCommits: file.gitMaxCommits },
    lifecycle: DEFAULT_LIFECYCLE,
    authoring: DEFAULT_AUTHORING,
    docsDir: file.docsDir,
    ignore: [...new Set([...MANDATORY_IGNORE, ...file.ignore])],
    gitMaxCommits: file.gitMaxCommits,
    triage: file.triage,
    neo4j,
  };
}

/** Interim identity for roots without .prdm.yaml (replaced by project discovery in WO-017): stable per checkout path. */
function legacyProject(rootAbs: string): ProjectRef {
  const root = existsSync(rootAbs) ? realpathSync(rootAbs) : rootAbs;
  const id = `prj_${createHash('sha256').update(root).digest('hex').slice(0, 16)}`;
  return { id, name: basename(root), root };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

interface Neo4jUriOrigin {
  /** `true` when `NEO4J_URI` came from the real process environment rather than the repository's `.env`. */
  uriFromRealEnv: boolean;
  /** `true` when `NEO4J_PASSWORD` came from the real process environment rather than the repository's `.env`. */
  passwordFromRealEnv: boolean;
}

/** Basic auth over plain bolt would send the password to whatever host a repository's .env names, so remote hosts need an explicit opt-in. */
function assertLocalNeo4j(uri: string, allowRemote: boolean, origin: Neo4jUriOrigin): void {
  let host: string;
  try {
    host = new URL(uri).hostname;
  } catch {
    throw new Error(`NEO4J_URI is not a valid URI: ${uri}`);
  }
  if (LOOPBACK_HOSTS.has(host) || host.startsWith('127.')) return;
  if (!allowRemote) throw new Error(`NEO4J_URI points to non-local host "${host}"; set PRDM_ALLOW_REMOTE_NEO4J=1 to allow it`);
  if (!origin.uriFromRealEnv && origin.passwordFromRealEnv) {
    throw new Error(
      `NEO4J_URI points to non-local host "${host}" and is set in .env while NEO4J_PASSWORD comes from the environment; ` +
        'set NEO4J_URI in the environment too before allowing a remote host',
    );
  }
}

function readConfigFile(path: string): z.infer<typeof fileSchema> {
  if (!existsSync(path)) return fileSchema.parse({});
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`prdm.config.json is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`prdm.config.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}
