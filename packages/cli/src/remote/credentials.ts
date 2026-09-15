/**
 * `$XDG_CONFIG_HOME/prdm/credentials.json` (SDD-010 "CLI: credenciales y vinculación", WO-187): one
 * personal token per exact origin, never anything a repo controls decides where to send. File mode
 * `0600`, containing directory mode `0700`, opened without following a symlink (`O_NOFOLLOW` on the
 * actual open, not just an `lstat` check beforehand — a `stat`-then-`open` pair would leave a race
 * window), and refused outright if the file or directory turns out readable/writable by anyone else —
 * checked with `fs.statSync` *after* creation, since `umask` can still widen a mode passed to
 * `open`/`mkdir` beyond what was requested.
 */
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export class InsecureCredentialsPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsecureCredentialsPathError';
  }
}

export interface StoredCredential {
  token: string;
}

/** Keyed by the exact origin (scheme + host + port) a credential was issued for — never a bare
 * hostname, so `https://a.example.com` and `https://a.example.com:8443` are never confused. */
export type CredentialsFile = Record<string, StoredCredential>;

function xdgConfigHome(env: NodeJS.ProcessEnv): string {
  const configured = env.XDG_CONFIG_HOME;
  return configured && configured.length > 0 ? configured : join(homedir(), '.config');
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(xdgConfigHome(env), 'prdm', 'credentials.json');
}

function credentialsDir(env: NodeJS.ProcessEnv): string {
  return dirname(credentialsPath(env));
}

/** Throws if `path` exists and is (or its final component is) a symlink — checked with `lstat`, which
 * never follows the link itself, unlike `stat`. */
function assertNotSymlink(path: string): void {
  if (!existsSync(path)) return;
  if (lstatSync(path).isSymbolicLink()) {
    throw new InsecureCredentialsPathError(`refusing to use ${path}: it is a symlink`);
  }
}

/** Refuses if group or other has any permission bit at all (mode & 0o077 must be zero) — stricter than
 * merely "not world-writable", matching SDD-010's "rechazado si otros pueden leerlo". */
function assertPrivateMode(path: string, kind: 'file' | 'directory'): void {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new InsecureCredentialsPathError(`refusing to use ${path}: this ${kind} is readable or writable by group/other (mode ${mode.toString(8)})`);
  }
}

/** Directory mode `0700`, refusing to follow (or silently reuse) a symlink, created idempotently.
 * Re-checks the real mode after `mkdirSync` since `umask` can widen it beyond what was requested. */
function ensurePrivateDir(dir: string): void {
  assertNotSymlink(dir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertNotSymlink(dir);
  assertPrivateMode(dir, 'directory');
}

/** Returns `{}` when the file doesn't exist yet (a fresh install); throws `InsecureCredentialsPathError`
 * for a symlinked or group/other-readable existing file instead of silently trusting it. */
export function loadCredentials(env: NodeJS.ProcessEnv = process.env): CredentialsFile {
  const dir = credentialsDir(env);
  if (existsSync(dir)) assertNotSymlink(dir);
  const path = credentialsPath(env);
  if (!existsSync(path)) return {};

  assertNotSymlink(path);
  assertPrivateMode(path, 'file');
  // O_NOFOLLOW: refuses atomically if `path`'s final component turns out to be a symlink at open time,
  // closing the TOCTOU window the `lstat` check above alone can't fully close.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const raw = readFileSync(fd, 'utf8');
    return JSON.parse(raw) as CredentialsFile;
  } finally {
    closeSync(fd);
  }
}

/** Overwrites the whole credentials file (never a partial merge at the fs layer — callers read-modify-
 * write the in-memory object first). Refuses to overwrite an existing symlinked or insecurely-permissioned
 * file rather than silently replacing it. */
export function saveCredentials(credentials: CredentialsFile, env: NodeJS.ProcessEnv = process.env): void {
  ensurePrivateDir(credentialsDir(env));
  const path = credentialsPath(env);
  if (existsSync(path)) {
    assertNotSymlink(path);
    assertPrivateMode(path, 'file');
  }

  const contents = `${JSON.stringify(credentials, null, 2)}\n`;
  // O_NOFOLLOW here too: a symlink swapped in between the checks above and this open is refused, not
  // followed. O_TRUNC|O_CREAT with an explicit 0o600 mode; re-verified below since umask can still
  // widen it.
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, contents);
  } finally {
    closeSync(fd);
  }
  assertPrivateMode(path, 'file');
}
