import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const RECORD = '\x1e';
const FIELD = '\x1f';
const WO_ID = /^WO-\d{3,}$/;

export interface CommitInfo {
  sha: string;
  author: string;
  date: string;
  subject: string;
  refs: string[];
  files: string[];
}

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, maxBuffer: MAX_BUFFER, encoding: 'utf8' });
    return stdout;
  } catch {
    return null;
  }
}

export async function isGitRepo(root: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--is-inside-work-tree']))?.trim() === 'true';
}

export async function readCommit(root: string, sha: string): Promise<CommitInfo | null> {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
  const format = `${RECORD}%H${FIELD}%an${FIELD}%aI${FIELD}%s${FIELD}%B${FIELD}`;
  const out = await git(root, ['log', '-1', '--name-only', '--no-renames', `--format=${format}`, `${sha}^{commit}`, '--']);
  const chunk = out?.split(RECORD).find((c) => c.trim() !== '');
  return chunk ? parseCommit(chunk) : null;
}

export async function readCommits(root: string, maxCount: number): Promise<CommitInfo[]> {
  if (!(await isGitRepo(root)) || (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])) === null) return [];
  const format = `${RECORD}%H${FIELD}%an${FIELD}%aI${FIELD}%s${FIELD}%B${FIELD}`;
  const out = await git(root, ['log', `--max-count=${Math.max(1, Math.floor(maxCount))}`, '--name-only', '--no-renames', `--format=${format}`]);
  if (!out) return [];
  return out
    .split(RECORD)
    .filter((chunk) => chunk.trim() !== '')
    .map(parseCommit);
}

function parseCommit(chunk: string): CommitInfo {
  const [sha = '', author = '', date = '', subject = '', body = '', filesBlock = ''] = chunk.split(FIELD);
  return {
    sha,
    author,
    date,
    subject,
    refs: parseRefs(body),
    files: filesBlock.split('\n').map((f) => f.trim()).filter(Boolean),
  };
}

export function parseRefs(message: string): string[] {
  const refs = new Set<string>();
  for (const line of message.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.slice(0, 5).toLowerCase() !== 'refs:') continue;
    for (const token of trimmed.slice(5).split(/[\s,]+/)) {
      if (WO_ID.test(token)) refs.add(token);
    }
  }
  return [...refs];
}

export async function dirtyPaths(root: string): Promise<Set<string>> {
  if (!(await isGitRepo(root))) return new Set();
  const out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const paths = new Set<string>();
  if (!out) return paths;
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    if (entry.length < 4) continue;
    paths.add(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i++;
  }
  return paths;
}
