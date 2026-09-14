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
  SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
  SMTP_PORT: z.string().regex(/^\d+$/, 'SMTP_PORT must be a numeric string').transform((value) => Number.parseInt(value, 10)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().min(1, 'SMTP_FROM is required'),
  SMTP_SECURE: z.enum(['0', '1']).optional().default('0').transform((value) => value === '1'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.string().url().optional(),
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
}

export interface ServerEnv {
  nodeEnv: NodeEnv;
  serverPort: number;
  publicUrl: string;
  betterAuthSecret: string;
  databaseUrl: string;
  trustedOrigins: string[];
  trustProxy: boolean;
  smtp: SmtpEnv;
  deepseek?: DeepSeekEnv;
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
  const deepseek: DeepSeekEnv | undefined = data.DEEPSEEK_API_KEY ? { apiKey: data.DEEPSEEK_API_KEY, baseUrl: data.DEEPSEEK_BASE_URL } : undefined;
  return {
    nodeEnv: resolveNodeEnv(data.NODE_ENV),
    serverPort: Number.parseInt(data.PRDM_SERVER_PORT, 10),
    publicUrl: data.PRDM_PUBLIC_URL,
    betterAuthSecret: data.BETTER_AUTH_SECRET,
    databaseUrl: data.DATABASE_URL,
    trustedOrigins: data.PRDM_TRUSTED_ORIGINS,
    trustProxy: data.PRDM_TRUST_PROXY,
    smtp: {
      host: data.SMTP_HOST,
      port: data.SMTP_PORT,
      secure: data.SMTP_SECURE,
      user: data.SMTP_USER,
      pass: data.SMTP_PASS,
      from: data.SMTP_FROM,
    },
    deepseek,
  };
}
