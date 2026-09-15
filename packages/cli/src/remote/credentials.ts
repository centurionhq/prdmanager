/**
 * `$XDG_CONFIG_HOME/prdm/credentials.json` (SDD-010 "CLI: credenciales y vinculación", WO-187): one
 * personal token per exact origin, never anything a repo controls decides where to send. File mode
 * `0600`, containing directory mode `0700`, opened without following a symlink (`O_NOFOLLOW` on the
 * actual open, not just an `lstat` check beforehand — a `stat`-then-`open` pair would leave a race
 * window), and refused outright if the file or directory turns out readable/writable by anyone else —
 * checked with `fs.statSync` *after* creation, since `umask` can still widen a mode passed to
 * `open`/`mkdir` beyond what was requested.
 *
 * WO-234 extends this same file (rather than inventing a second local-state file) with `projectPins`:
 * the `graphProjectId` `prdm link` resolved for a given repo root, keyed by that root's absolute path.
 * `.prdm.yaml`'s `project.id` is repo-tracked — a PR could edit it to silently retarget a developer's
 * `sync`/`mcp-proxy` runs at a different project (SDD-010's threat model: nothing a repo controls should
 * ever decide where a token/report goes) — so every subsequent run compares the *locally pinned* id
 * against whatever `.prdm.yaml` currently claims, aborting on mismatch exactly like the existing
 * `remote.server` cross-check already does. The on-disk shape is `{ tokens, projectPins }`; a
 * pre-WO-234 file (a bare `Record<origin, StoredCredential>`, no `tokens` key at all) is transparently
 * read as legacy `tokens` with empty `projectPins` — an existing logged-in user's credentials file is
 * never blown away by this change.
 */
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CliError } from '../errors.js';
import { isCi } from './server-origin.js';

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

/** The `graphProjectId` `prdm link` resolved for a repo, and the origin it was resolved against (kept
 * alongside it purely for a clearer abort message — the origin mismatch itself is still
 * `server-origin.ts`/`mcp-proxy.ts`'s own, separate check). */
export interface ProjectPin {
  server: string;
  graphProjectId: string;
}

/** Keyed by a repo root's absolute, normalized path (`node:path`'s `resolve`) — never the bare string a
 * caller happened to pass, so `.` and an equivalent absolute path always hit the same entry. */
export type ProjectPinsFile = Record<string, ProjectPin>;

interface CredentialsStore {
  tokens: CredentialsFile;
  projectPins: ProjectPinsFile;
}

function isStoreShape(value: unknown): value is CredentialsStore {
  return typeof value === 'object' && value !== null && 'tokens' in value && 'projectPins' in value;
}

/** A pre-WO-234 file is a bare `CredentialsFile` (no `tokens` wrapper at all) — read as legacy `tokens`
 * with no pins yet, never discarded. */
function normalizeStore(parsed: unknown): CredentialsStore {
  if (isStoreShape(parsed)) return { tokens: parsed.tokens, projectPins: parsed.projectPins };
  return { tokens: (parsed as CredentialsFile) ?? {}, projectPins: {} };
}

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

/** Returns an empty store when the file doesn't exist yet (a fresh install); throws
 * `InsecureCredentialsPathError` for a symlinked or group/other-readable existing file instead of
 * silently trusting it. */
function loadStore(env: NodeJS.ProcessEnv): CredentialsStore {
  const dir = credentialsDir(env);
  if (existsSync(dir)) assertNotSymlink(dir);
  const path = credentialsPath(env);
  if (!existsSync(path)) return { tokens: {}, projectPins: {} };

  assertNotSymlink(path);
  assertPrivateMode(path, 'file');
  // O_NOFOLLOW: refuses atomically if `path`'s final component turns out to be a symlink at open time,
  // closing the TOCTOU window the `lstat` check above alone can't fully close.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const raw = readFileSync(fd, 'utf8');
    return normalizeStore(JSON.parse(raw) as unknown);
  } finally {
    closeSync(fd);
  }
}

/** Overwrites the whole credentials file (never a partial merge at the fs layer — callers read-modify-
 * write the in-memory object first). Refuses to overwrite an existing symlinked or insecurely-permissioned
 * file rather than silently replacing it. */
function saveStore(store: CredentialsStore, env: NodeJS.ProcessEnv): void {
  ensurePrivateDir(credentialsDir(env));
  const path = credentialsPath(env);
  if (existsSync(path)) {
    assertNotSymlink(path);
    assertPrivateMode(path, 'file');
  }

  const contents = `${JSON.stringify(store, null, 2)}\n`;
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

export function loadCredentials(env: NodeJS.ProcessEnv = process.env): CredentialsFile {
  return loadStore(env).tokens;
}

/** Overwrites only the `tokens` section — `projectPins` (whatever `prdm link` has already recorded for
 * any repo) is read back from disk first and carried through untouched, so a `login`/`logout` call can
 * never silently wipe out an unrelated repo's pin. */
export function saveCredentials(credentials: CredentialsFile, env: NodeJS.ProcessEnv = process.env): void {
  const existing = loadStore(env);
  saveStore({ tokens: credentials, projectPins: existing.projectPins }, env);
}

/** The `graphProjectId` `prdm link` last pinned for `root` (its absolute, normalized path), or
 * `undefined` if this repo was never linked from this machine. */
export function loadProjectPin(root: string, env: NodeJS.ProcessEnv = process.env): ProjectPin | undefined {
  return loadStore(env).projectPins[resolve(root)];
}

/** Records (or overwrites) `root`'s pin — called once, at `prdm link` time. Preserves every other repo's
 * pin and every stored token untouched. */
export function saveProjectPin(root: string, pin: ProjectPin, env: NodeJS.ProcessEnv = process.env): void {
  const existing = loadStore(env);
  saveStore({ tokens: existing.tokens, projectPins: { ...existing.projectPins, [resolve(root)]: pin } }, env);
}

/**
 * A pure check shared by every remote entry point that reads `.prdm.yaml`'s repo-tracked `project.id`
 * (WO-234) — `null` when it agrees with the local, non-repo-controlled pin `prdm link` recorded;
 * otherwise a ready-to-display reason a caller wraps in its own error type (`McpProxyAbortError` for
 * `mcp-proxy.ts`, `CliError` for `sync.ts` and friends), mirroring how `server-origin.ts`'s
 * `resolveRemoteServerOrigin` already cross-checks `remote.server` the same way.
 */
export function checkProjectPinMismatch(root: string, remoteProjectId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pin = loadProjectPin(root, env);
  if (!pin) return 'no local project pin recorded for this repository; run "prdm link" first';
  if (pin.graphProjectId !== remoteProjectId) {
    return `.prdm.yaml's project.id is "${remoteProjectId}", but this repository was linked to "${pin.graphProjectId}"; refusing to guess which one is correct — run "prdm link" again if the project genuinely changed`;
  }
  return null;
}

/**
 * Resolves the token to use for `origin`, or throws `CliError` (WO-239). Mirrors
 * `resolveRemoteServerOrigin`'s own CI-mandatory shape exactly:
 *  - In CI, `PRDM_TOKEN` is mandatory (SDD-010: "en CI ... el token de PRDM_TOKEN") — the on-disk store
 *    is never consulted in CI, since a fresh runner has no such file and a stale one baked into a
 *    self-hosted runner image must never be trusted over the workflow's own explicit secret.
 *  - Outside CI, `PRDM_TOKEN` (when set) takes precedence over the local store — useful for scripting —
 *    otherwise falls back to whatever `prdm login` already recorded for this exact origin.
 */
export function resolveRemoteCredential(origin: string, env: NodeJS.ProcessEnv = process.env): string {
  const prdmToken = env.PRDM_TOKEN;
  if (isCi(env)) {
    if (!prdmToken) throw new CliError('PRDM_TOKEN is required in CI for a remote-mode project (it was not set)');
    return prdmToken;
  }
  if (prdmToken) return prdmToken;
  const stored = loadCredentials(env)[origin];
  if (!stored) throw new CliError(`not logged in to ${origin}; run "prdm login --server ${origin}" first`);
  return stored.token;
}
