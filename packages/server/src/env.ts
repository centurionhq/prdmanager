/**
 * Minimal env surface for this slice (WO-088): only what `main.ts` needs to bind and to tag the
 * injected `env` dependency of `buildServer`. The full zod-validated environment schema (`PRDM_PUBLIC_URL`,
 * `BETTER_AUTH_SECRET`, secret redaction, etc.) is SDD-006's own later task — not scoped here.
 */
export type NodeEnv = 'development' | 'test' | 'production';

export interface ServerEnv {
  nodeEnv: NodeEnv;
}

export function resolveServerEnv(env: NodeJS.ProcessEnv): ServerEnv {
  const nodeEnv: NodeEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  return { nodeEnv };
}

/** `main.ts` always binds loopback in this slice; a configurable host (with an allowlist guard, SDD-006 style) is later work. */
export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_PORT = 4601;

/** Resolves `PRDM_SERVER_PORT` (default 4601), rejecting anything that isn't an integer in the valid TCP port range. */
export function resolveServerPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PRDM_SERVER_PORT ?? String(DEFAULT_SERVER_PORT);
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== raw.trim()) {
    throw new Error(`PRDM_SERVER_PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}
