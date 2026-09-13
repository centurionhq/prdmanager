import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';

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
  docsDir: string;
  ignore: string[];
  gitMaxCommits: number;
  triage: { autoLinkMinScore: number; autoLinkMargin: number; maxCandidates: number };
  neo4j: Neo4jConfig;
}

export function loadConfig(root: string, env: NodeJS.ProcessEnv = process.env): PrdmConfig {
  const rootAbs = resolve(root);
  const file = readConfigFile(join(rootAbs, 'prdm.config.json'));
  const dotenvPath = join(rootAbs, '.env');
  const dotenv = existsSync(dotenvPath) ? parseDotenv(readFileSync(dotenvPath)) : {};
  const get = (key: string): string | undefined => env[key] ?? dotenv[key];

  const password = get('NEO4J_PASSWORD');
  if (!password) throw new Error('NEO4J_PASSWORD is not set (define it in .env or the environment)');

  return {
    root: rootAbs,
    docsDir: file.docsDir,
    ignore: [...new Set([...MANDATORY_IGNORE, ...file.ignore])],
    gitMaxCommits: file.gitMaxCommits,
    triage: file.triage,
    neo4j: {
      uri: get('NEO4J_URI') ?? 'neo4j://127.0.0.1:7687',
      username: get('NEO4J_USERNAME') ?? 'neo4j',
      password,
      database: get('NEO4J_DATABASE') ?? 'neo4j',
    },
  };
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
