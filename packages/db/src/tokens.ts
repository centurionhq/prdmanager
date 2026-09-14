/**
 * Personal and CI API tokens (SDD-006 §Modelo de datos / §Permisos "Scopes de tokens", WO-109).
 *
 * A token's public string is `<prefix>.<secret>`: `prefix` (`prdm_pat_`/`prdm_ci_` + 16 lowercase hex
 * random id chars + a 2-digit checksum of that id) is stored verbatim in `api_tokens.prefix` and is
 * exactly what a secret scanner (gitleaks, GitHub's own) needs to flag a leaked token by regex alone,
 * with no database access. `secret` is 32 random bytes, base64url-encoded; only its sha256
 * (`secret_hash`) is ever persisted (`hashTokenSecret`), matching SDD-006: "búsqueda por sha256 vía
 * función SECURITY DEFINER". The full string is generated once (`issuePersonalToken`/`issueCiToken`)
 * and never recoverable afterward — `findTokenById`/`listTokens` never select `secret_hash` into their
 * return shape.
 *
 * `parseTokenString` validates the prefix format and checksum *before* any DB lookup happens (SDD-006 /
 * WO-109: "valida formato+checksum antes de cualquier lookup en DB") — a malformed or corrupted token
 * never reaches `resolveTokenBySecret`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { projects } from './schema/projects.js';
import { apiTokens } from './schema/tokens.js';
import { connect, type PgDatabase } from './pool.js';
import { withTenantTx } from './tenant.js';

export const TOKEN_KINDS = ['personal', 'project_ci'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const TOKEN_SCOPES = ['mcp:read', 'mcp:write', 'governance:read', 'reports:write', 'reports:baseline', 'import:write'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** SDD-006 §Permisos "Scopes de tokens" table: a personal token never gets `reports:baseline`; a CI
 * token never gets `mcp:read`/`mcp:write`/`import:write`. Enforced both here (token creation can't even
 * request a scope its kind isn't allowed) and again at request time by the Bearer preHandler (WO-110). */
export const ALLOWED_SCOPES_BY_KIND: Readonly<Record<TokenKind, readonly TokenScope[]>> = {
  personal: ['mcp:read', 'mcp:write', 'governance:read', 'reports:write', 'import:write'],
  project_ci: ['governance:read', 'reports:write', 'reports:baseline'],
};

export const MAX_TOKEN_TTL_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** SDD-006 §Permisos: "last_used_at como máximo una vez por minuto." */
export const LAST_USED_AT_THROTTLE_MS = 60_000;

const PREFIX_BY_KIND: Readonly<Record<TokenKind, string>> = {
  personal: 'prdm_pat_',
  project_ci: 'prdm_ci_',
};

const TOKEN_STRING_PATTERN = /^(prdm_pat_|prdm_ci_)([0-9a-f]{16})([0-9]{2})\.([A-Za-z0-9_-]{32,64})$/;

/** A small, non-cryptographic checksum over the random id (two decimal digits, zero-padded): only
 * meant to catch truncation/typos/corruption before a wasted DB round trip — never a security boundary
 * (that's `secret_hash`). Sum of char codes mod 100. */
function checksumOf(randomId: string): string {
  let sum = 0;
  for (let i = 0; i < randomId.length; i += 1) sum += randomId.charCodeAt(i);
  return String(sum % 100).padStart(2, '0');
}

export function hashTokenSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export interface GeneratedToken {
  /** The full `<prefix>.<secret>` string; returned to the caller exactly once, never persisted. */
  token: string;
  prefix: string;
  secretHash: string;
}

function generateToken(kind: TokenKind): GeneratedToken {
  const randomId = randomBytes(8).toString('hex');
  const prefix = `${PREFIX_BY_KIND[kind]}${randomId}${checksumOf(randomId)}`;
  const secret = randomBytes(32).toString('base64url');
  const token = `${prefix}.${secret}`;
  return { token, prefix, secretHash: hashTokenSecret(secret) };
}

export interface ParsedTokenString {
  kind: TokenKind;
  prefix: string;
  secret: string;
}

/** Format + checksum validation only — no DB access. Returns `null` for anything that doesn't parse as
 * a well-formed token string or whose checksum doesn't match its random id (SDD-006 / WO-109: rejected
 * "antes de cualquier lookup en DB"). */
export function parseTokenString(value: string): ParsedTokenString | null {
  const match = TOKEN_STRING_PATTERN.exec(value);
  if (!match) return null;
  const [, prefixLiteral, randomId, checksum, secret] = match as unknown as [string, string, string, string, string];
  if (checksumOf(randomId) !== checksum) return null;
  const kind: TokenKind = prefixLiteral === 'prdm_pat_' ? 'personal' : 'project_ci';
  return { kind, prefix: `${prefixLiteral}${randomId}${checksum}`, secret };
}

export class InvalidScopeError extends Error {
  constructor(scope: string, kind: TokenKind) {
    super(`scope ${scope} is not allowed for ${kind} tokens`);
    this.name = 'InvalidScopeError';
  }
}

export class TokenTtlTooLongError extends Error {
  constructor() {
    super(`expiresAt must be within ${MAX_TOKEN_TTL_DAYS} days of now`);
    this.name = 'TokenTtlTooLongError';
  }
}

export class ProjectNotInOrgError extends Error {
  constructor() {
    super('one or more project ids do not belong to this organization');
    this.name = 'ProjectNotInOrgError';
  }
}

function assertScopesAllowed(kind: TokenKind, scopes: readonly string[]): void {
  const allowed = new Set<string>(ALLOWED_SCOPES_BY_KIND[kind]);
  for (const scope of scopes) {
    if (!allowed.has(scope)) throw new InvalidScopeError(scope, kind);
  }
}

function assertTtlWithinMax(now: Date, expiresAt: Date): void {
  if (expiresAt.getTime() - now.getTime() > MAX_TOKEN_TTL_DAYS * MS_PER_DAY) throw new TokenTtlTooLongError();
  if (expiresAt.getTime() <= now.getTime()) throw new TokenTtlTooLongError();
}

export interface TokenRecord {
  id: string;
  orgId: string;
  kind: TokenKind;
  userId: string | null;
  projectIds: string[] | null;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

/** Never selects `secret_hash` — the only way any code path could leak it is a future column added to
 * this list by mistake, so keep this shape exact. */
const TOKEN_COLUMNS = {
  id: apiTokens.id,
  orgId: apiTokens.orgId,
  kind: apiTokens.kind,
  userId: apiTokens.userId,
  projectIds: apiTokens.projectIds,
  name: apiTokens.name,
  prefix: apiTokens.prefix,
  scopes: apiTokens.scopes,
  expiresAt: apiTokens.expiresAt,
  lastUsedAt: apiTokens.lastUsedAt,
  revokedAt: apiTokens.revokedAt,
  createdBy: apiTokens.createdBy,
  createdAt: apiTokens.createdAt,
} as const;

export interface CreatePersonalTokenInput {
  orgId: string;
  userId: string;
  name: string;
  scopes: readonly TokenScope[];
  expiresAt: Date;
  now?: Date;
}

export interface CreatedToken {
  record: TokenRecord;
  /** The full secret string — present only on the response to the creating request. */
  token: string;
}

export async function createPersonalToken(pool: Pool, input: CreatePersonalTokenInput): Promise<CreatedToken> {
  const now = input.now ?? new Date();
  assertScopesAllowed('personal', input.scopes);
  assertTtlWithinMax(now, input.expiresAt);
  const generated = generateToken('personal');
  const record = await withTenantTx(pool, input.orgId, async (tx) => {
    const [row] = await tx
      .insert(apiTokens)
      .values({
        orgId: input.orgId,
        kind: 'personal',
        userId: input.userId,
        projectIds: null,
        name: input.name,
        prefix: generated.prefix,
        secretHash: generated.secretHash,
        scopes: [...input.scopes],
        expiresAt: input.expiresAt,
        createdBy: input.userId,
        createdAt: now,
      })
      .returning(TOKEN_COLUMNS);
    return row!;
  });
  return { record: record as TokenRecord, token: generated.token };
}

/** Checks every `projectId` in `projectIds` resolves to a `projects` row in `orgId` — the array-column
 * equivalent of a composite FK, which Postgres can't express directly on an array element. Must run
 * inside the same tenant transaction the insert itself uses so RLS already scopes `projects` to
 * `orgId`; a project id from another org (or that doesn't exist) simply isn't visible, so `count` comes
 * back short. */
async function assertProjectIdsBelongToOrg(tx: PgDatabase, projectIds: readonly string[]): Promise<void> {
  if (projectIds.length === 0) throw new ProjectNotInOrgError();
  const rows = await tx.select({ id: projects.id }).from(projects).where(inArray(projects.id, [...projectIds]));
  if (rows.length !== new Set(projectIds).size) throw new ProjectNotInOrgError();
}

export interface CreateCiTokenInput {
  orgId: string;
  projectIds: readonly string[];
  name: string;
  scopes: readonly TokenScope[];
  expiresAt: Date;
  createdBy: string;
  now?: Date;
}

export async function createCiToken(pool: Pool, input: CreateCiTokenInput): Promise<CreatedToken> {
  const now = input.now ?? new Date();
  assertScopesAllowed('project_ci', input.scopes);
  assertTtlWithinMax(now, input.expiresAt);
  const generated = generateToken('project_ci');
  const record = await withTenantTx(pool, input.orgId, async (tx) => {
    await assertProjectIdsBelongToOrg(tx, input.projectIds);
    const [row] = await tx
      .insert(apiTokens)
      .values({
        orgId: input.orgId,
        kind: 'project_ci',
        userId: null,
        projectIds: [...input.projectIds],
        name: input.name,
        prefix: generated.prefix,
        secretHash: generated.secretHash,
        scopes: [...input.scopes],
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
        createdAt: now,
      })
      .returning(TOKEN_COLUMNS);
    return row!;
  });
  return { record: record as TokenRecord, token: generated.token };
}

export async function listPersonalTokens(pool: Pool, orgId: string, userId: string): Promise<TokenRecord[]> {
  return withTenantTx(pool, orgId, (tx) =>
    tx.select(TOKEN_COLUMNS).from(apiTokens).where(and(eq(apiTokens.kind, 'personal'), eq(apiTokens.userId, userId))),
  ) as Promise<TokenRecord[]>;
}

export async function listCiTokensForProject(pool: Pool, orgId: string, projectId: string): Promise<TokenRecord[]> {
  return withTenantTx(pool, orgId, (tx) =>
    tx
      .select(TOKEN_COLUMNS)
      .from(apiTokens)
      .where(and(eq(apiTokens.kind, 'project_ci'), sql`${apiTokens.projectIds} @> ARRAY[${projectId}::uuid]`)),
  ) as Promise<TokenRecord[]>;
}

export async function findTokenById(pool: Pool, orgId: string, tokenId: string): Promise<TokenRecord | null> {
  const rows = await withTenantTx(pool, orgId, (tx) => tx.select(TOKEN_COLUMNS).from(apiTokens).where(eq(apiTokens.id, tokenId)));
  return (rows[0] as TokenRecord | undefined) ?? null;
}

export interface RevokeTokenInput {
  orgId: string;
  tokenId: string;
  now?: Date;
}

/** Idempotent: revoking an already-revoked token is a no-op, not an error (SDD-006: "revocación
 * inmediata"). */
export async function revokeToken(pool: Pool, input: RevokeTokenInput): Promise<void> {
  const now = input.now ?? new Date();
  await withTenantTx(pool, input.orgId, async (tx) => {
    await tx.update(apiTokens).set({ revokedAt: now }).where(and(eq(apiTokens.id, input.tokenId), isNull(apiTokens.revokedAt)));
  });
}

export interface ResolvedToken {
  id: string;
  orgId: string;
  kind: TokenKind;
  userId: string | null;
  projectIds: string[] | null;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
}

interface ResolveTokenRow extends Record<string, unknown> {
  id: string;
  org_id: string;
  kind: TokenKind;
  user_id: string | null;
  project_ids: string[] | null;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
}

/** The only lookup path before `org_id` is known (see module doc comment): matches purely on
 * `secretHash` via the `resolve_token` `SECURITY DEFINER` function. Returns `null` for no match —
 * expiry/revocation are left to the caller (the Bearer plugin) so it can tell the three cases apart. */
export async function resolveTokenBySecret(pool: Pool, secret: string): Promise<ResolvedToken | null> {
  const hash = hashTokenSecret(secret);
  const db = connect(pool);
  const result = await db.execute<ResolveTokenRow>(sql`SELECT * FROM resolve_token(${hash})`);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    kind: row.kind,
    userId: row.user_id,
    projectIds: row.project_ids,
    scopes: row.scopes,
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}

export interface TouchLastUsedInput {
  orgId: string;
  tokenId: string;
  now: Date;
}

/** SDD-006 §Permisos: "last_used_at como máximo una vez por minuto" — only writes when there is no
 * `last_used_at` yet or the last write is older than {@link LAST_USED_AT_THROTTLE_MS}, so a token used
 * on every request of a hot loop still only issues one UPDATE per minute. `now` is always injected by
 * the caller (the Bearer plugin's own clock) — never `new Date()` here — so tests never depend on real
 * elapsed time. */
export async function touchTokenLastUsed(pool: Pool, input: TouchLastUsedInput): Promise<void> {
  const threshold = new Date(input.now.getTime() - LAST_USED_AT_THROTTLE_MS);
  await withTenantTx(pool, input.orgId, async (tx) => {
    await tx
      .update(apiTokens)
      .set({ lastUsedAt: input.now })
      .where(and(eq(apiTokens.id, input.tokenId), sql`(${apiTokens.lastUsedAt} IS NULL OR ${apiTokens.lastUsedAt} < ${threshold})`));
  });
}
