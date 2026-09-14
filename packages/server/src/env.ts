/**
 * Server environment schema (SDD-006 §Autenticación / §Cabeceras, WO-091): the *only* place
 * `process.env` is parsed and validated. `main.ts` calls `resolveServerEnv(process.env)` exactly
 * once and threads the resulting `ServerEnv` through `buildServer(deps)`; nothing else in this
 * package reads `process.env` directly.
 */
import { z } from 'zod';

export type NodeEnv = 'development' | 'test' | 'production';

export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_PORT = 4601;

/** Thrown by `resolveServerEnv` with every failing field's path and message, never the offending value. */
export class ServerEnvError extends Error {
  constructor(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
    const details = issues.map((issue) => `  - ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('\n');
    super(`invalid server environment:\n${details}`);
    this.name = 'ServerEnvError';
  }
}

function isValidPort(value: string): boolean {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 && String(port) === value.trim();
}

const portStringSchema = z
  .string()
  .default(String(DEFAULT_SERVER_PORT))
  .refine(isValidPort, { message: 'PRDM_SERVER_PORT must be an integer between 1 and 65535' });

const trustedOriginsSchema = z
  .string()
  .min(1, 'PRDM_TRUSTED_ORIGINS is required')
  .transform((value, ctx) => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    if (origins.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'PRDM_TRUSTED_ORIGINS must list at least one origin' });
      return z.NEVER;
    }
    for (const origin of origins) {
      if (origin.includes('*')) {
        ctx.addIssue({ code: 'custom', message: `PRDM_TRUSTED_ORIGINS must not contain wildcards ("${origin}")` });
        return z.NEVER;
      }
      const parsed = z.string().url().safeParse(origin);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: `PRDM_TRUSTED_ORIGINS entry "${origin}" is not a valid absolute URL` });
        return z.NEVER;
      }
    }
    return origins;
  });

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number.parseInt(value, 10) > 0;
}

/** SDD-008 §"Servidor de tiempo real": `@fastify/websocket`'s own `maxPayload` (forwarded to `ws`,
 * confirmed by `packages/server/tests/learning/hocuspocus-fastify.test.ts`) for the `/collab` upgrade —
 * an oversized frame closes the raw socket with code 1009 before any Hocuspocus/Yjs framing runs. */
const collabMaxPayloadBytesSchema = z
  .string()
  .default('1048576')
  .refine(isPositiveInteger, { message: 'PRDM_COLLAB_MAX_PAYLOAD_BYTES must be a positive integer' });

/** SDD-008 §"Servidor de tiempo real": the six numeric limits, all configurable, all defaulting to the
 * SDD's own documented values (WO-152). */
function positiveIntegerSchema(defaultValue: number, envName: string) {
  return z
    .string()
    .default(String(defaultValue))
    .refine(isPositiveInteger, { message: `${envName} must be a positive integer` });
}

const collabMaxRenderedBytesSchema = positiveIntegerSchema(512 * 1024, 'PRDM_COLLAB_MAX_RENDERED_BYTES');
const collabMaxEncodedStateBytesSchema = positiveIntegerSchema(20 * 1024 * 1024, 'PRDM_COLLAB_MAX_ENCODED_STATE_BYTES');
const collabMaxConnectionsPerUserSchema = positiveIntegerSchema(20, 'PRDM_COLLAB_MAX_CONNECTIONS_PER_USER');
const collabMaxConnectionsPerDocumentSchema = positiveIntegerSchema(50, 'PRDM_COLLAB_MAX_CONNECTIONS_PER_DOCUMENT');
const collabMaxUpdatesPerSecPerUserSchema = positiveIntegerSchema(30, 'PRDM_COLLAB_MAX_UPDATES_PER_SEC_PER_USER');
const collabMaxUpdatesPerSecPerDocumentSchema = positiveIntegerSchema(100, 'PRDM_COLLAB_MAX_UPDATES_PER_SEC_PER_DOCUMENT');

const trustProxySchema = z
  .enum(['0', '1'])
  .optional()
  .default('0')
  .transform((value) => value === '1');

const betterAuthSecretSchema = z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32, {
  message: 'BETTER_AUTH_SECRET must be at least 32 bytes',
});

const databaseUrlSchema = z.string().min(1, 'DATABASE_URL is required').refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
    } catch {
      return false;
    }
  },
  { message: 'DATABASE_URL must be a valid postgres:// connection string' },
);

const rawServerEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  PRDM_SERVER_PORT: portStringSchema,
  PRDM_PUBLIC_URL: z.string().url('PRDM_PUBLIC_URL must be a valid absolute URL'),
  BETTER_AUTH_SECRET: betterAuthSecretSchema,
  DATABASE_URL: databaseUrlSchema,
  PRDM_TRUSTED_ORIGINS: trustedOriginsSchema,
  PRDM_TRUST_PROXY: trustProxySchema,
  PRDM_COLLAB_MAX_PAYLOAD_BYTES: collabMaxPayloadBytesSchema,
  PRDM_COLLAB_MAX_RENDERED_BYTES: collabMaxRenderedBytesSchema,
  PRDM_COLLAB_MAX_ENCODED_STATE_BYTES: collabMaxEncodedStateBytesSchema,
  PRDM_COLLAB_MAX_CONNECTIONS_PER_USER: collabMaxConnectionsPerUserSchema,
  PRDM_COLLAB_MAX_CONNECTIONS_PER_DOCUMENT: collabMaxConnectionsPerDocumentSchema,
  PRDM_COLLAB_MAX_UPDATES_PER_SEC_PER_USER: collabMaxUpdatesPerSecPerUserSchema,
  PRDM_COLLAB_MAX_UPDATES_PER_SEC_PER_DOCUMENT: collabMaxUpdatesPerSecPerDocumentSchema,
  SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
  SMTP_PORT: z.string().regex(/^\d+$/, 'SMTP_PORT must be a numeric string').transform((value) => Number.parseInt(value, 10)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().min(1, 'SMTP_FROM is required'),
  SMTP_SECURE: z.enum(['0', '1']).optional().default('0').transform((value) => value === '1'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.string().url().optional(),
  DEEPSEEK_MODEL: z.string().min(1).optional(),
  // SDD-009 §Seguridad y costo: per-organization/global daily token quotas and per-user rate limit for
  // the agent (WO-175) — all optional with SDD-documented-shape defaults so existing deployments/tests
  // that never configure the agent keep working unchanged.
  PRDM_AGENT_DAILY_TOKENS_PER_ORG: positiveIntegerSchema(200_000, 'PRDM_AGENT_DAILY_TOKENS_PER_ORG'),
  PRDM_AGENT_DAILY_TOKENS_GLOBAL: positiveIntegerSchema(2_000_000, 'PRDM_AGENT_DAILY_TOKENS_GLOBAL'),
  PRDM_AGENT_RPM_PER_USER: positiveIntegerSchema(10, 'PRDM_AGENT_RPM_PER_USER'),
  // SDD-007 "PgProjectEngine" (WO-137): the graph store every project's outbox projection writes to.
  // Unlike the CLI's `loadConfig` (`assertLocalNeo4j`), the server has no "accidentally overwrote my
  // local dev graph" risk to guard against — it is always expected to reach a real, possibly remote,
  // operator-configured instance.
  NEO4J_URI: z.string().url('NEO4J_URI must be a valid URI').optional().default('neo4j://127.0.0.1:7687'),
  NEO4J_USERNAME: z.string().min(1).optional().default('neo4j'),
  NEO4J_PASSWORD: z.string().min(1, 'NEO4J_PASSWORD is required'),
  NEO4J_DATABASE: z.string().min(1).optional().default('neo4j'),
});

export interface SmtpEnv {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface DeepSeekEnv {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/** SDD-009 §Seguridad y costo (WO-175): quotas/rate limit, always present (SDD-documented defaults apply
 * even when the agent itself is disabled — `deepseek` being unset already gates whether it can ever run). */
export interface AgentQuotaEnv {
  dailyTokensPerOrg: number;
  dailyTokensGlobal: number;
  rpmPerUser: number;
}

export interface Neo4jEnv {
  uri: string;
  username: string;
  password: string;
  database: string;
}

/** SDD-008 §"Servidor de tiempo real" (WO-152): the six numeric limits, one struct so callers never
 * have to thread six separate scalars through. */
export interface CollabLimitsEnv {
  maxRenderedBytes: number;
  maxEncodedStateBytes: number;
  maxConnectionsPerUser: number;
  maxConnectionsPerDocument: number;
  maxUpdatesPerSecPerUser: number;
  maxUpdatesPerSecPerDocument: number;
}

export interface ServerEnv {
  nodeEnv: NodeEnv;
  serverPort: number;
  publicUrl: string;
  betterAuthSecret: string;
  databaseUrl: string;
  trustedOrigins: string[];
  trustProxy: boolean;
  collabMaxPayloadBytes: number;
  collabLimits: CollabLimitsEnv;
  smtp: SmtpEnv;
  deepseek?: DeepSeekEnv;
  agentQuotas: AgentQuotaEnv;
  neo4j: Neo4jEnv;
}

function resolveNodeEnv(value: string | undefined): NodeEnv {
  return value === 'production' ? 'production' : value === 'test' ? 'test' : 'development';
}

/**
 * Parses and validates every variable this server needs from `env` (normally `process.env`),
 * throwing a single `ServerEnvError` that lists every failing field if any are missing or malformed.
 * Never logs or embeds the raw `env` object in the thrown error.
 */
export function resolveServerEnv(env: NodeJS.ProcessEnv): ServerEnv {
  const parsed = rawServerEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ServerEnvError(parsed.error.issues);
  }
  const data = parsed.data;
  const deepseek: DeepSeekEnv | undefined = data.DEEPSEEK_API_KEY
    ? { apiKey: data.DEEPSEEK_API_KEY, baseUrl: data.DEEPSEEK_BASE_URL, model: data.DEEPSEEK_MODEL }
    : undefined;
  return {
    nodeEnv: resolveNodeEnv(data.NODE_ENV),
    serverPort: Number.parseInt(data.PRDM_SERVER_PORT, 10),
    publicUrl: data.PRDM_PUBLIC_URL,
    betterAuthSecret: data.BETTER_AUTH_SECRET,
    databaseUrl: data.DATABASE_URL,
    trustedOrigins: data.PRDM_TRUSTED_ORIGINS,
    trustProxy: data.PRDM_TRUST_PROXY,
    collabMaxPayloadBytes: Number.parseInt(data.PRDM_COLLAB_MAX_PAYLOAD_BYTES, 10),
    collabLimits: {
      maxRenderedBytes: Number.parseInt(data.PRDM_COLLAB_MAX_RENDERED_BYTES, 10),
      maxEncodedStateBytes: Number.parseInt(data.PRDM_COLLAB_MAX_ENCODED_STATE_BYTES, 10),
      maxConnectionsPerUser: Number.parseInt(data.PRDM_COLLAB_MAX_CONNECTIONS_PER_USER, 10),
      maxConnectionsPerDocument: Number.parseInt(data.PRDM_COLLAB_MAX_CONNECTIONS_PER_DOCUMENT, 10),
      maxUpdatesPerSecPerUser: Number.parseInt(data.PRDM_COLLAB_MAX_UPDATES_PER_SEC_PER_USER, 10),
      maxUpdatesPerSecPerDocument: Number.parseInt(data.PRDM_COLLAB_MAX_UPDATES_PER_SEC_PER_DOCUMENT, 10),
    },
    smtp: {
      host: data.SMTP_HOST,
      port: data.SMTP_PORT,
      secure: data.SMTP_SECURE,
      user: data.SMTP_USER,
      pass: data.SMTP_PASS,
      from: data.SMTP_FROM,
    },
    deepseek,
    agentQuotas: {
      dailyTokensPerOrg: Number.parseInt(data.PRDM_AGENT_DAILY_TOKENS_PER_ORG, 10),
      dailyTokensGlobal: Number.parseInt(data.PRDM_AGENT_DAILY_TOKENS_GLOBAL, 10),
      rpmPerUser: Number.parseInt(data.PRDM_AGENT_RPM_PER_USER, 10),
    },
    neo4j: { uri: data.NEO4J_URI, username: data.NEO4J_USERNAME, password: data.NEO4J_PASSWORD, database: data.NEO4J_DATABASE },
  };
}
