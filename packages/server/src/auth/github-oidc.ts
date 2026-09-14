/**
 * GitHub Actions OIDC verification (SDD-010 "Contexto"/"Sync de developers y drift", WO-179): the only
 * mechanism that can ever earn a `code-report` (WO-180/WO-181) baseline trust. Verified with `jose`
 * (pinned to 6.2.12 per ADR-006) against the real JWKS at
 * `https://token.actions.githubusercontent.com/.well-known/jwks` by default — injectable
 * (`githubOidcJwks` in `BuildServerDeps`, `./build-server.js`) so tests supply a `createLocalJWKSet`
 * built from a throwaway keypair instead of ever touching the network.
 *
 * Every check below is mandatory; failing any one throws {@link GithubOidcVerificationError} with a
 * distinct `code` so a caller can log/react precisely rather than lumping every rejection into a bare
 * 400:
 *  - `alg: RS256` exactly, and `iss` exactly `GITHUB_OIDC_ISSUER` (jose's own `algorithms`/`issuer`
 *    options — a token signed some other way, or by some other issuer, never even reaches JWKS
 *    resolution for the *right* key).
 *  - `aud` exactly the server's own `PRDM_PUBLIC_URL` (the caller passes this in — never anything the
 *    token itself claims about who its audience "should" be).
 *  - `exp`/`nbf` (jose's own claim validation, `clockTolerance`) and `iat` (checked here explicitly —
 *    jose does not reject a future `iat` on its own) all within {@link OIDC_CLOCK_SKEW_TOLERANCE_SECONDS}
 *    of the *injected* clock (`now`), never `Date.now()` directly.
 *  - `jti` single-use: {@link OidcJtiStore.claim} is an atomic "insert if absent" (`packages/db`'s
 *    `buildPgOidcJtiStore`), so two concurrent verifications of the same token can never both succeed.
 *  - `repository_id`/`repository_owner_id` — never the repository *name*, which GitHub happily reuses
 *    once a repo is deleted or renamed — matching what the caller captured in the project's `settings`
 *    at configuration time.
 *  - `ref === refs/heads/<settings.default_branch>` and `event_name === 'push'` (a workflow triggered
 *    any other way, or on any other ref, never earns baseline trust).
 *  - `sha` matching the report's own `head_sha`, passed in by the caller — never re-derived from the
 *    token in a way that could ever disagree with what is actually being reported.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { OidcJtiStore } from '@prdm/db';

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const GITHUB_OIDC_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
export const OIDC_CLOCK_SKEW_TOLERANCE_SECONDS = 60;

/** Production default: a real, network-backed JWKS resolver (jose caches/rate-limits internally). */
export function githubOidcRemoteJwks(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS_URL));
}

/** Test-only fallback (`buildServer` uses this only when neither a real `pool` nor an explicit
 * `oidcJtiStore` override is given) — a real deployment always gets `@prdm/db`'s `buildPgOidcJtiStore`,
 * whose uniqueness guarantee survives a process restart and multiple server instances; this one does
 * not, and exists purely so `buildServer({ env })` (no pool) never crashes constructing a default. */
export function createInMemoryOidcJtiStore(): OidcJtiStore {
  const seen = new Set<string>();
  return {
    async claim(jti) {
      if (seen.has(jti)) return false;
      seen.add(jti);
      return true;
    },
  };
}

export type GithubOidcErrorCode = 'invalid_token' | 'clock_skew' | 'jti_reused' | 'repository_mismatch' | 'ref_mismatch' | 'event_mismatch' | 'sha_mismatch';

export class GithubOidcVerificationError extends Error {
  readonly code: GithubOidcErrorCode;
  constructor(code: GithubOidcErrorCode, message: string) {
    super(message);
    this.name = 'GithubOidcVerificationError';
    this.code = code;
  }
}

export interface GithubOidcClaims {
  iss: string;
  aud: string;
  sub: string;
  repositoryId: string;
  repositoryOwnerId: string;
  ref: string;
  eventName: string;
  sha: string;
  jti: string;
  exp: number;
  iat: number;
}

export interface VerifyGithubActionsOidcInput {
  token: string;
  jwks: JWTVerifyGetKey;
  jtiStore: OidcJtiStore;
  /** Injected clock (SDD-006/SDD-010: never `Date.now()` directly). */
  now: () => Date;
  audience: string;
  expectedRepositoryId: string;
  expectedRepositoryOwnerId: string;
  expectedDefaultBranch: string;
  expectedHeadSha: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function invalid(message: string): never {
  throw new GithubOidcVerificationError('invalid_token', message);
}

/**
 * Verifies signature, standard claims and every GitHub-Actions-specific claim listed in this module's
 * doc comment, in that order (cheapest/most-fundamental first) — a caller only ever needs to catch
 * {@link GithubOidcVerificationError} and inspect `.code`.
 */
export async function verifyGithubActionsOidc(input: VerifyGithubActionsOidcInput): Promise<GithubOidcClaims> {
  const now = input.now();

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(input.token, input.jwks, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: input.audience,
      algorithms: ['RS256'],
      clockTolerance: OIDC_CLOCK_SKEW_TOLERANCE_SECONDS,
      currentDate: now,
    });
    payload = result.payload;
  } catch (err) {
    invalid(`GitHub OIDC token failed verification: ${err instanceof Error ? err.message : String(err)}`);
  }

  const iat = typeof payload.iat === 'number' ? payload.iat : undefined;
  const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
  if (iat === undefined) invalid('GitHub OIDC token is missing "iat"');
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (iat > nowSeconds + OIDC_CLOCK_SKEW_TOLERANCE_SECONDS) {
    throw new GithubOidcVerificationError('clock_skew', 'GitHub OIDC token "iat" is too far in the future');
  }

  const jti = payload.jti;
  const repositoryId = payload.repository_id;
  const repositoryOwnerId = payload.repository_owner_id;
  const ref = payload.ref;
  const eventName = payload.event_name;
  const sha = payload.sha;
  if (!isNonEmptyString(jti) || !isNonEmptyString(repositoryId) || !isNonEmptyString(repositoryOwnerId) || !isNonEmptyString(ref) || !isNonEmptyString(eventName) || !isNonEmptyString(sha)) {
    invalid('GitHub OIDC token is missing one or more required claims (jti/repository_id/repository_owner_id/ref/event_name/sha)');
  }

  if (repositoryId !== input.expectedRepositoryId || repositoryOwnerId !== input.expectedRepositoryOwnerId) {
    throw new GithubOidcVerificationError('repository_mismatch', 'GitHub OIDC token repository_id/repository_owner_id does not match the project settings');
  }
  if (ref !== `refs/heads/${input.expectedDefaultBranch}`) {
    throw new GithubOidcVerificationError('ref_mismatch', `GitHub OIDC token ref "${ref}" is not the project's default branch`);
  }
  if (eventName !== 'push') {
    throw new GithubOidcVerificationError('event_mismatch', `GitHub OIDC token event_name "${eventName}" is not "push"`);
  }
  if (sha !== input.expectedHeadSha) {
    throw new GithubOidcVerificationError('sha_mismatch', 'GitHub OIDC token sha does not match the report head_sha');
  }

  // Single-use *after* every other check passes: a malformed/mismatched token must never consume a
  // jti it was never going to be trusted with anyway.
  const jtiExpiresAt = exp !== undefined ? new Date(exp * 1000) : new Date(now.getTime() + 300_000);
  const claimed = await input.jtiStore.claim(jti, jtiExpiresAt);
  if (!claimed) {
    throw new GithubOidcVerificationError('jti_reused', 'GitHub OIDC token "jti" has already been used');
  }

  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: input.audience,
    sub: typeof payload.sub === 'string' ? payload.sub : '',
    repositoryId,
    repositoryOwnerId,
    ref,
    eventName,
    sha,
    jti,
    exp: exp ?? nowSeconds,
    iat,
  };
}
