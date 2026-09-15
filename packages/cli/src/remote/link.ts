/**
 * `prdm link <org>/<project>` (SDD-010 "CLI: credenciales y vinculación", WO-188): the testable core of
 * the `link` command, split from `commands/link.ts` the same way `remote/login.ts` is split from
 * `commands/login.ts` — `env`/`fetchImpl` are injectable so tests never touch the real
 * `$XDG_CONFIG_HOME` or network.
 */
import { applyLink, planLink, type LinkFileWrite, type OfflinePolicy } from '@prdm/core';
import { CliError } from '../errors.js';
import { loadCredentials, saveProjectPin } from './credentials.js';
import { readLocalImportPayload, uploadImportPayload } from './import.js';
import { resolveRemoteProject, type ResolveRemoteProjectDeps } from './mcp-client.js';
import { parseServerUrl } from './server-url.js';

export interface LinkIoDeps extends ResolveRemoteProjectDeps {
  stdout: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface LinkOptions {
  server: string;
  target: string;
  mcp?: boolean;
  import?: boolean;
  offlinePolicy?: OfflinePolicy;
}

export interface LinkResult {
  graphProjectId: string;
  writes: LinkFileWrite[];
}

export function splitOrgProject(target: string): { org: string; project: string } {
  const parts = target.split('/');
  if (parts.length !== 2 || parts[0]!.length === 0 || parts[1]!.length === 0) {
    throw new CliError(`invalid target "${target}"; expected "<org>/<project>"`);
  }
  return { org: parts[0]!, project: parts[1]! };
}

export async function runLink(root: string, options: LinkOptions, deps: LinkIoDeps): Promise<LinkResult> {
  const { org, project } = splitOrgProject(options.target);
  const url = parseServerUrl(options.server);

  const credentials = loadCredentials(deps.env);
  const credential = credentials[url.origin];
  if (!credential) throw new CliError(`not logged in to ${url.origin}; run "prdm login --server ${url.origin}" first`);

  const resolved = await resolveRemoteProject(url.origin, credential.token, org, project, { fetchImpl: deps.fetchImpl });

  // Read (and client-side validate) the *current*, still-local `.prdm.yaml`/docs before `planLink`/
  // `applyLink` below ever overwrites `.prdm.yaml` with the `version: 2` remote file — otherwise there
  // would be nothing left of the original local project to import from.
  const importPayload = options.import ? await readLocalImportPayload(root) : null;

  const plan = await planLink(root, {
    projectId: resolved.graphProjectId,
    projectName: resolved.name,
    server: url.origin,
    org,
    project,
    offlinePolicy: options.offlinePolicy ?? 'warn',
    mcp: options.mcp,
  });
  await applyLink(root, plan);

  // WO-234: pinned locally (never in the repo-tracked `.prdm.yaml` itself) so a later PR editing
  // `project.id` can be detected as a mismatch by `mcp-proxy`/`sync`, instead of silently retargeting
  // this repo's runs at a different project.
  saveProjectPin(root, { server: url.origin, graphProjectId: resolved.graphProjectId }, deps.env);

  if (plan.writes.length === 0) deps.stdout('nothing to do: already linked');
  else for (const write of plan.writes) deps.stdout(`wrote ${write.path}`);

  if (importPayload) {
    await uploadImportPayload(importPayload, { server: url.origin, graphProjectId: resolved.graphProjectId, token: credential.token }, { stdout: deps.stdout, fetchImpl: deps.fetchImpl });
  }

  return { graphProjectId: resolved.graphProjectId, writes: plan.writes };
}
