/**
 * `verifyGithubActionsOidc` (SDD-010, WO-179): every mandatory check, against a throwaway RS256 keypair
 * and `createLocalJWKSet` — never the real network.
 */
import { createInMemoryOidcJtiStore } from '../../src/auth/github-oidc.js';
import { GITHUB_OIDC_ISSUER, GithubOidcVerificationError, verifyGithubActionsOidc } from '../../src/auth/github-oidc.js';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, test } from 'vitest';

const AUDIENCE = 'https://prdm.example.test';
const EXPECTED_REPOSITORY_ID = '123456';
const EXPECTED_REPOSITORY_OWNER_ID = '78910';
const EXPECTED_DEFAULT_BRANCH = 'main';
const EXPECTED_HEAD_SHA = 'a'.repeat(40);
const KID = 'test-key';

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwks: JWTVerifyGetKey;

interface TokenOverrides {
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
  jti?: string;
  repository_id?: string;
  repository_owner_id?: string;
  ref?: string;
  event_name?: string;
  sha?: string;
}

async function signToken(nowSeconds: number, overrides: TokenOverrides = {}): Promise<string> {
  const claims = {
    repository_id: EXPECTED_REPOSITORY_ID,
    repository_owner_id: EXPECTED_REPOSITORY_OWNER_ID,
    ref: `refs/heads/${EXPECTED_DEFAULT_BRANCH}`,
    event_name: 'push',
    sha: EXPECTED_HEAD_SHA,
    jti: overrides.jti ?? `jti-${Math.random()}`,
    ...overrides,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(overrides.iss ?? GITHUB_OIDC_ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setIssuedAt(overrides.iat ?? nowSeconds)
    .setExpirationTime(overrides.exp ?? nowSeconds + 300)
    .sign(privateKey);
}

function baseInput(token: string, overrides: Partial<Parameters<typeof verifyGithubActionsOidc>[0]> = {}) {
  return {
    token,
    jwks,
    jtiStore: createInMemoryOidcJtiStore(),
    now: () => new Date(1_700_000_000_000),
    audience: AUDIENCE,
    expectedRepositoryId: EXPECTED_REPOSITORY_ID,
    expectedRepositoryOwnerId: EXPECTED_REPOSITORY_OWNER_ID,
    expectedDefaultBranch: EXPECTED_DEFAULT_BRANCH,
    expectedHeadSha: EXPECTED_HEAD_SHA,
    ...overrides,
  };
}

const NOW_SECONDS = 1_700_000_000;

beforeAll(async () => {
  const { publicKey, privateKey: sk } = await generateKeyPair('RS256');
  privateKey = sk;
  const jwk = await exportJWK(publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: 'RS256' }] });
});

describe('verifyGithubActionsOidc (WO-179)', () => {
  test('accepts a fully valid token', async () => {
    const token = await signToken(NOW_SECONDS);
    const claims = await verifyGithubActionsOidc(baseInput(token));
    expect(claims.repositoryId).toBe(EXPECTED_REPOSITORY_ID);
    expect(claims.sha).toBe(EXPECTED_HEAD_SHA);
  });

  test('rejects the wrong issuer', async () => {
    const token = await signToken(NOW_SECONDS, { iss: 'https://evil.example.test' });
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toThrow(GithubOidcVerificationError);
  });

  test('rejects the wrong audience', async () => {
    const token = await signToken(NOW_SECONDS, { aud: 'https://someone-else.example.test' });
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toMatchObject({ code: 'invalid_token' });
  });

  test('rejects an expired token', async () => {
    const token = await signToken(NOW_SECONDS, { exp: NOW_SECONDS - 1000 });
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toMatchObject({ code: 'invalid_token' });
  });

  test('rejects a reused jti', async () => {
    const jtiStore = createInMemoryOidcJtiStore();
    const token = await signToken(NOW_SECONDS, { jti: 'fixed-jti' });
    await verifyGithubActionsOidc(baseInput(token, { jtiStore }));
    const secondToken = await signToken(NOW_SECONDS, { jti: 'fixed-jti' });
    await expect(verifyGithubActionsOidc(baseInput(secondToken, { jtiStore }))).rejects.toMatchObject({ code: 'jti_reused' });
  });

  test('rejects a mismatched repository_id, even with the same repository name irrelevant to this claim set', async () => {
    const token = await signToken(NOW_SECONDS, { repository_id: 'a-different-repo-id' });
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toMatchObject({ code: 'repository_mismatch' });
  });

  test('rejects a mismatched repository_owner_id', async () => {
    const token = await signToken(NOW_SECONDS, { repository_owner_id: 'a-different-owner-id' });
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toMatchObject({ code: 'repository_mismatch' });
  });

  test('rejects a ref that is not the project default branch', async () => {
    const token = await signToken(NOW_SECONDS, { ref: 'refs/heads/feature-x' });
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toMatchObject({ code: 'ref_mismatch' });
  });

  test('rejects an event_name other than push', async () => {
    const token = await signToken(NOW_SECONDS, { event_name: 'pull_request' });
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toMatchObject({ code: 'event_mismatch' });
  });

  test('rejects a sha that does not match the report head_sha', async () => {
    const token = await signToken(NOW_SECONDS, { sha: 'b'.repeat(40) });
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toMatchObject({ code: 'sha_mismatch' });
  });

  test('accepts iat/exp within the 60s clock skew tolerance', async () => {
    const token = await signToken(NOW_SECONDS + 45);
    await expect(verifyGithubActionsOidc(baseInput(token))).resolves.toBeDefined();
  });

  test('rejects an iat far in the future beyond tolerance', async () => {
    const token = await signToken(NOW_SECONDS + 1000);
    await expect(verifyGithubActionsOidc(baseInput(token))).rejects.toMatchObject({ code: 'clock_skew' });
  });
});
