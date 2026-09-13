import { basename } from 'node:path';
import { DOC_KINDS } from '../domain/schema.js';
import { generateProjectId, parseProjectFile, renderProjectFile, type ProjectFileSettings } from '../project/file.js';
import { DEFAULT_AUTHORING, DEFAULT_FOLDERS, DEFAULT_GIT, DEFAULT_LIFECYCLE } from '../project/types.js';
import { readCommits } from '../sync/git.js';
import { safeReadFile, safeWriteFile } from '../util/safe-fs.js';
import { parseLegacyConfig } from './adopt.js';
import { foldersForDocsDir } from './folders.js';
import { planGitignore } from './gitignore.js';
import { planMcpJson } from './mcp-config.js';

const LEGACY_CONFIG_FILE = 'prdm.config.json';
const PROJECT_FILE = '.prdm.yaml';

export interface InitOptions {
  /** Defaults to the target directory's basename when omitted. */
  name?: string;
  adopt?: boolean;
  mcp?: boolean;
  force?: boolean;
  /** Injectable for deterministic tests; forwarded to {@link generateProjectId}. */
  random?: (size: number) => Buffer;
}

export interface InitFileWrite {
  path: string;
  content: string;
}

export interface InitPlan {
  projectFile: ProjectFileSettings;
  writes: InitFileWrite[];
  notes: string[];
}

const DEFAULT_TRIAGE = { autoLinkMinScore: 0.5, autoLinkMargin: 1.05, maxCandidates: 5, minMatchedTerms: 2 };

async function loadExistingProjectFile(root: string, force: boolean | undefined): Promise<ProjectFileSettings | null> {
  const raw = await safeReadFile(root, PROJECT_FILE);
  if (raw === null) return null;
  try {
    return parseProjectFile(raw);
  } catch (err) {
    if (!force) throw new Error(`refusing to touch an invalid ${PROJECT_FILE} (use --force to regenerate it): ${(err as Error).message}`);
    return null;
  }
}

async function currentHeadSha(root: string): Promise<string | null> {
  const commits = await readCommits(root, 1);
  return commits[0]?.sha ?? null;
}

async function adoptSettings(root: string, name: string, random: ((size: number) => Buffer) | undefined, notes: string[]): Promise<ProjectFileSettings> {
  const legacyRaw = await safeReadFile(root, LEGACY_CONFIG_FILE);
  if (legacyRaw === null) throw new Error(`--adopt requires ${LEGACY_CONFIG_FILE} in the target directory`);
  const legacy = parseLegacyConfig(legacyRaw);
  const headSha = await currentHeadSha(root);
  notes.push(`${LEGACY_CONFIG_FILE} was not deleted; remove it once ${PROJECT_FILE} is committed`);
  return {
    project: { id: generateProjectId(random), name },
    docsDir: legacy.docsDir,
    folders: foldersForDocsDir(legacy.docsDir),
    ignore: legacy.ignore,
    git: { maxCommits: legacy.gitMaxCommits, enforceRefs: true, enforceRefsSince: headSha },
    triage: legacy.triage,
    lifecycle: DEFAULT_LIFECYCLE,
    authoring: DEFAULT_AUTHORING,
  };
}

function freshSettings(name: string, random: ((size: number) => Buffer) | undefined): ProjectFileSettings {
  return {
    project: { id: generateProjectId(random), name },
    docsDir: 'docs',
    folders: DEFAULT_FOLDERS,
    ignore: [],
    git: DEFAULT_GIT,
    triage: DEFAULT_TRIAGE,
    lifecycle: DEFAULT_LIFECYCLE,
    authoring: DEFAULT_AUTHORING,
  };
}

async function resolveSettings(root: string, options: InitOptions, notes: string[]): Promise<{ settings: ProjectFileSettings; existingRaw: string | null }> {
  const existingRaw = await safeReadFile(root, PROJECT_FILE);
  const existing = await loadExistingProjectFile(root, options.force);
  const name = options.name ?? basename(root);

  if (existing) {
    if (options.adopt) notes.push(`--adopt ignored: ${PROJECT_FILE} already exists`);
    const settings: ProjectFileSettings = { ...existing, project: { id: existing.project.id, name: options.name ?? existing.project.name } };
    return { settings, existingRaw };
  }
  const settings = options.adopt ? await adoptSettings(root, name, options.random, notes) : freshSettings(name, options.random);
  return { settings, existingRaw };
}

function gitkeepWrites(settings: ProjectFileSettings, existingPaths: ReadonlySet<string>): InitFileWrite[] {
  return DOC_KINDS.filter((kind) => !existingPaths.has(`${settings.folders[kind]}/.gitkeep`)).map((kind) => ({
    path: `${settings.folders[kind]}/.gitkeep`,
    content: '',
  }));
}

/**
 * Reads the target directory's current state and computes every file operation `prdm init` would perform, without
 * writing anything. Re-running `planInit` after `applyInit` on the same options returns an empty `writes` list
 * (SDD-002 "Proyecto activo": init is idempotent).
 */
export async function planInit(root: string, options: InitOptions): Promise<InitPlan> {
  const notes: string[] = [];
  const { settings, existingRaw } = await resolveSettings(root, options, notes);

  const writes: InitFileWrite[] = [];
  const rendered = renderProjectFile(settings);
  if (existingRaw !== rendered) writes.push({ path: PROJECT_FILE, content: rendered });

  const existingGitkeeps = new Set<string>();
  for (const kind of DOC_KINDS) {
    const path = `${settings.folders[kind]}/.gitkeep`;
    if ((await safeReadFile(root, path)) !== null) existingGitkeeps.add(path);
  }
  writes.push(...gitkeepWrites(settings, existingGitkeeps));

  const gitignore = planGitignore(await safeReadFile(root, '.gitignore'));
  if (gitignore !== null) writes.push({ path: '.gitignore', content: gitignore });

  if (options.mcp) {
    const mcpJson = planMcpJson(await safeReadFile(root, '.mcp.json'));
    if (mcpJson !== null) writes.push({ path: '.mcp.json', content: mcpJson });
  }

  return { projectFile: settings, writes, notes };
}

/** Applies every write in `plan` inside `root`, via `safe-fs` (no path can escape the target directory). */
export async function applyInit(root: string, plan: InitPlan): Promise<void> {
  for (const write of plan.writes) await safeWriteFile(root, write.path, write.content);
}
