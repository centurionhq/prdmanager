/**
 * `.prdm.yaml` `version: 2` (SDD-010 "CLI: credenciales y vinculación", WO-188): the `remote` project
 * format `prdm link` writes. Deliberately tiny compared to {@link import('./file.js').ProjectFileSettings}
 * — `git.*`/`lifecycle`/`ignore`/`folders`/`docs_dir` are never part of this file at all (WO-190: those
 * come exclusively from the server's `governance` response), so there is nothing here a compromised repo
 * could edit to override them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { z } from 'zod';
import { parseProjectYamlRoot, projectIdSchema, projectNameSchema } from './file.js';

export const OFFLINE_POLICY_VALUES = ['warn', 'block'] as const;
export type OfflinePolicy = (typeof OFFLINE_POLICY_VALUES)[number];

const remoteFileSchema = z.strictObject({
  /** Origin the CLI/proxy send requests to (and the exact key `prdm login`'s credentials are stored
   * under) — e.g. `https://app.example.com`. Validated as a URL by the CLI layer (`server-url.ts`) at
   * `prdm link` time; this schema only checks it is a non-empty, reasonably sized string, since
   * `@prdm/core` has no `URL`-parsing opinion of its own to duplicate. */
  server: z.string().min(1).max(500),
  org: z.string().min(1).max(200),
  project: z.string().min(1).max(200),
  offline_policy: z.enum(OFFLINE_POLICY_VALUES).default('warn'),
});

const rawRemoteProjectFileSchema = z.strictObject({
  version: z.literal(2),
  project: z.strictObject({ id: projectIdSchema, name: projectNameSchema }),
  remote: remoteFileSchema,
});

export interface RemoteProjectConfig {
  server: string;
  org: string;
  project: string;
  offlinePolicy: OfflinePolicy;
}

export interface RemoteProjectFile {
  version: 2;
  /** `project.id` is always the `graph_project_id` the server returned at `prdm link` time — never
   * invented locally (SDD-010). */
  project: { id: string; name: string };
  remote: RemoteProjectConfig;
}

function toRemoteSettings(raw: z.infer<typeof rawRemoteProjectFileSchema>): RemoteProjectFile {
  return {
    version: 2,
    project: raw.project,
    remote: { server: raw.remote.server, org: raw.remote.org, project: raw.remote.project, offlinePolicy: raw.remote.offline_policy },
  };
}

function parseRemoteProjectFileUnsafe(src: string): RemoteProjectFile {
  const root = parseProjectYamlRoot(src);
  const result = rawRemoteProjectFileSchema.safeParse(root);
  if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  return toRemoteSettings(result.data);
}

/** Parses and validates a `version: 2` `.prdm.yaml`; every failure is wrapped, same convention as `parseProjectFile`. */
export function parseRemoteProjectFile(src: string): RemoteProjectFile {
  try {
    return parseRemoteProjectFileUnsafe(src);
  } catch (err) {
    throw new Error(`.prdm.yaml is invalid: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Deterministic serializer, the `version: 2` counterpart of `renderProjectFile`. */
export function renderRemoteProjectFile(settings: RemoteProjectFile): string {
  const raw = {
    version: 2,
    project: { id: settings.project.id, name: settings.project.name },
    remote: { server: settings.remote.server, org: settings.remote.org, project: settings.remote.project, offline_policy: settings.remote.offlinePolicy },
  };
  return stringify(raw, { schema: 'core', version: '1.2' });
}

/**
 * `.prdm.yaml` at `root`, cheaply classified: `null` when the file doesn't exist, `{ kind: 'local' }` when
 * it exists but isn't `version: 2` (a normal local project — this function never runs the full v1 schema,
 * so a locally-invalid `.prdm.yaml` still reports `'local'` here; the caller's own local-mode loader is
 * what eventually surfaces that error), or the fully-validated `remote` config. Used by every mode-guard
 * in this WO batch (mutating CLI commands, the stdio MCP server, `sync`, `check`, hooks) so none of them
 * needs to re-implement "is this repo linked to a remote project".
 */
export type ProjectFileMode = { kind: 'none' } | { kind: 'local' } | { kind: 'remote'; file: RemoteProjectFile };

export function detectProjectFileMode(root: string): ProjectFileMode {
  const path = join(root, '.prdm.yaml');
  if (!existsSync(path)) return { kind: 'none' };
  const src = readFileSync(path, 'utf8');
  let parsedRoot: unknown;
  try {
    parsedRoot = parseProjectYamlRoot(src);
  } catch {
    // Malformed in some other way: not this function's job to report why — the real local-mode loader
    // (`parseProjectFile`) will throw the actual, detailed error when it's used.
    return { kind: 'local' };
  }
  if ((parsedRoot as { version?: unknown }).version !== 2) return { kind: 'local' };
  return { kind: 'remote', file: parseRemoteProjectFile(src) };
}

/** Convenience for the common case: the `remote` config, or `null` when this repo isn't remote-linked. */
export function loadRemoteProjectConfig(root: string): RemoteProjectFile | null {
  const mode = detectProjectFileMode(root);
  return mode.kind === 'remote' ? mode.file : null;
}
