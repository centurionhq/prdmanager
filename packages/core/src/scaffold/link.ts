/**
 * Pure planning half of `prdm link` (SDD-010 "CLI: credenciales y vinculación", WO-188): everything about
 * *what files change* once the CLI has already resolved `<org>/<project>` against the server (network I/O
 * and credential lookup are the CLI's own job, in `packages/cli`, which is why this module never makes a
 * request itself — same split as `scaffold/init.ts`'s `planInit`/`applyInit`).
 */
import { detectProjectFileMode, renderRemoteProjectFile, type OfflinePolicy, type RemoteProjectFile } from '../project/remote-file.js';
import { safeReadFile, safeWriteFile } from '../util/safe-fs.js';
import { planGitignoreLines, REMOTE_GITIGNORE_LINES } from './gitignore.js';
import { planRemoteMcpJson } from './mcp-config.js';

export interface PlanLinkInput {
  /** The `graph_project_id` the server returned for `<org>/<project>` — never invented locally. */
  projectId: string;
  projectName: string;
  server: string;
  org: string;
  project: string;
  offlinePolicy: OfflinePolicy;
  mcp?: boolean;
  /** `prdm link --import` (FB-009): the caller already read whatever it needed from the existing local
   * (`version: 1`) `.prdm.yaml` before calling this — an existing local project is exactly the case
   * `--import` exists to migrate, not a reason to refuse. */
  importing?: boolean;
}

export interface LinkFileWrite {
  path: string;
  content: string;
}

export interface LinkPlan {
  remoteFile: RemoteProjectFile;
  writes: LinkFileWrite[];
}

export class AlreadyLocalProjectError extends Error {}
export class ConflictingRemoteLinkError extends Error {}

function sameRemote(a: RemoteProjectFile, input: PlanLinkInput): boolean {
  return a.project.id === input.projectId && a.remote.server === input.server && a.remote.org === input.org && a.remote.project === input.project;
}

/**
 * Computes the file writes `prdm link` performs, without touching the filesystem. Refuses outright
 * (rather than silently overwriting) when `root` already has a `version: 1` `.prdm.yaml` (switching an
 * existing local project to remote is a decision an operator must make explicitly, e.g. by removing the
 * file first, or passing `--import` to migrate it) or a `version: 2` one pointing at a *different*
 * server/org/project (relinking a repository to a different remote project is never silent). Re-running
 * with the exact same target is idempotent.
 */
export async function planLink(root: string, input: PlanLinkInput): Promise<LinkPlan> {
  const mode = detectProjectFileMode(root);
  if (mode.kind === 'local' && !input.importing) {
    throw new AlreadyLocalProjectError('.prdm.yaml already exists as a local (version 1) project; remove it first, or pass --import to migrate it, if you really want to link this repository to a remote project');
  }
  if (mode.kind === 'remote' && !sameRemote(mode.file, input)) {
    throw new ConflictingRemoteLinkError(
      `.prdm.yaml is already linked to ${mode.file.remote.org}/${mode.file.remote.project} on ${mode.file.remote.server}; remove it first to link to a different project`,
    );
  }

  const remoteFile: RemoteProjectFile = {
    version: 2,
    project: { id: input.projectId, name: input.projectName },
    remote: { server: input.server, org: input.org, project: input.project, offlinePolicy: input.offlinePolicy },
  };

  const writes: LinkFileWrite[] = [];
  const rendered = renderRemoteProjectFile(remoteFile);
  const existingRaw = await safeReadFile(root, '.prdm.yaml');
  if (existingRaw !== rendered) writes.push({ path: '.prdm.yaml', content: rendered });

  const gitignore = planGitignoreLines(await safeReadFile(root, '.gitignore'), REMOTE_GITIGNORE_LINES);
  if (gitignore !== null) writes.push({ path: '.gitignore', content: gitignore });

  if (input.mcp) {
    const mcpJson = planRemoteMcpJson(await safeReadFile(root, '.mcp.json'));
    if (mcpJson !== null) writes.push({ path: '.mcp.json', content: mcpJson });
  }

  return { remoteFile, writes };
}

/** Applies every write in `plan` inside `root`, via `safe-fs` (no path can escape the target directory). */
export async function applyLink(root: string, plan: LinkPlan): Promise<void> {
  for (const write of plan.writes) await safeWriteFile(root, write.path, write.content);
}
