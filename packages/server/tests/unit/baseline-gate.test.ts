/**
 * `evaluateBaselineGate` (SDD-010 "Modo baseline de code-reports", WO-181): every ineligibility path
 * silently falls to preview except a head regression without an override, which is a distinct
 * rejection.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { beforeAll, describe, expect, test } from 'vitest';
import { evaluateBaselineGate, type EvaluateBaselineGateInput } from '../../src/engine/baseline-gate.js';
import { createInMemoryOidcJtiStore, GITHUB_OIDC_ISSUER } from '../../src/auth/github-oidc.js';
import type { CodeReportRequest, ProjectSettings } from '@prdm/contracts';

const AUDIENCE = 'https://prdm.example.test';
const REPO_ID = '123456';
const OWNER_ID = '78910';
const DEFAULT_BRANCH = 'main';
const HEAD_SHA = 'a'.repeat(40);
const KID = 'test-key';
const NOW_SECONDS = 1_700_000_000;

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const { publicKey, privateKey: sk } = await generateKeyPair('RS256');
  privateKey = sk;
  const jwk = await exportJWK(publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: 'RS256' }] });
});

async function signToken(overrides: Record<string, unknown> = {}): Promise<string> {
  const claims = {
    repository_id: REPO_ID,
    repository_owner_id: OWNER_ID,
    ref: `refs/heads/${DEFAULT_BRANCH}`,
    event_name: 'push',
    sha: HEAD_SHA,
    jti: `jti-${Math.random()}`,
    ...overrides,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(GITHUB_OIDC_ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(NOW_SECONDS)
    .setExpirationTime(NOW_SECONDS + 300)
    .sign(privateKey);
}

function settings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return {
    folders: {},
    ignore: [],
    git: { max_commits: 500, enforce_refs: true, enforce_refs_since: null },
    triage: { auto_link_min_score: 0.5, auto_link_margin: 1.05, max_candidates: 5, min_matched_terms: 2 },
    lifecycle: { grandfathered: [] },
    default_branch: DEFAULT_BRANCH,
    github_repository: 'acme/widgets',
    github_repository_id: Number(REPO_ID),
    github_owner_id: Number(OWNER_ID),
    hash_algo_version: 1,
    ...overrides,
  };
}

function report(overrides: Partial<CodeReportRequest> = {}): CodeReportRequest {
  return {
    schema_version: 1,
    client: { prdm_version: '0.2.0', hash_algo_version: 1 },
    branch: DEFAULT_BRANCH,
    head_sha: HEAD_SHA,
    docs_graph_version: '0',
    impacts_hashes: {},
    governed: [],
    governed_warnings: [],
    commits: [],
    dirty: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<EvaluateBaselineGateInput> = {}): EvaluateBaselineGateInput {
  return {
    token: { kind: 'project_ci', scopes: ['reports:baseline'] },
    oidcToken: undefined,
    settings: settings(),
    report: report(),
    registeredBaselineHeadSha: null,
    deps: {
      githubOidcJwks: jwks,
      oidcJtiStore: createInMemoryOidcJtiStore(),
      now: () => new Date(NOW_SECONDS * 1000),
      publicUrl: AUDIENCE,
      consumeForcePushOverride: async () => false,
    },
    ...overrides,
  };
}

describe('evaluateBaselineGate (WO-181)', () => {
  test('a personal token (never reports:baseline) silently falls to preview', async () => {
    const result = await evaluateBaselineGate(baseInput({ token: { kind: 'personal', scopes: ['reports:write'] } }));
    expect(result).toEqual({ mode: 'preview' });
  });

  test('a CI token without reports:baseline scope silently falls to preview', async () => {
    const result = await evaluateBaselineGate(baseInput({ token: { kind: 'project_ci', scopes: ['reports:write'] } }));
    expect(result).toEqual({ mode: 'preview' });
  });

  test('missing captured repository_id/owner_id in settings falls to preview', async () => {
    const result = await evaluateBaselineGate(baseInput({ settings: settings({ github_repository_id: null }) }));
    expect(result).toEqual({ mode: 'preview' });
  });

  test('mismatched hash_algo_version falls to preview', async () => {
    const result = await evaluateBaselineGate(baseInput({ report: report({ client: { prdm_version: '0.2.0', hash_algo_version: 2 } }) }));
    expect(result).toEqual({ mode: 'preview' });
  });

  test('no OIDC token attached falls to preview', async () => {
    const result = await evaluateBaselineGate(baseInput());
    expect(result).toEqual({ mode: 'preview' });
  });

  test('a feature-branch OIDC token (ref mismatch) silently falls to preview, not an error', async () => {
    const oidcToken = await signToken({ ref: 'refs/heads/feature-x' });
    const result = await evaluateBaselineGate(baseInput({ oidcToken }));
    expect(result).toEqual({ mode: 'preview' });
  });

  test('a valid OIDC token with no prior registered baseline head earns baseline mode', async () => {
    const oidcToken = await signToken();
    const result = await evaluateBaselineGate(baseInput({ oidcToken }));
    expect(result).toEqual({ mode: 'baseline' });
  });

  test('a fast-forward (registered head present among reported commits) earns baseline mode', async () => {
    const oidcToken = await signToken();
    const result = await evaluateBaselineGate(
      baseInput({
        oidcToken,
        registeredBaselineHeadSha: 'b'.repeat(40),
        report: report({ commits: [{ sha: 'b'.repeat(40), author: 'Alice', date: '2026-09-14T00:00:00.000Z', subject: 'x', refs: [], files: [] }] }),
      }),
    );
    expect(result).toEqual({ mode: 'baseline' });
  });

  test('a force-push (registered head absent from reported commits) without an override is rejected', async () => {
    const oidcToken = await signToken();
    const result = await evaluateBaselineGate(baseInput({ oidcToken, registeredBaselineHeadSha: 'c'.repeat(40) }));
    expect(result).toEqual({ mode: 'rejected', code: 'force_push_requires_admin_override' });
  });

  test('a force-push with a matching, consumable override earns baseline mode', async () => {
    const oidcToken = await signToken();
    const result = await evaluateBaselineGate(
      baseInput({
        oidcToken,
        registeredBaselineHeadSha: 'c'.repeat(40),
        deps: {
          githubOidcJwks: jwks,
          oidcJtiStore: createInMemoryOidcJtiStore(),
          now: () => new Date(NOW_SECONDS * 1000),
          publicUrl: AUDIENCE,
          consumeForcePushOverride: async () => true,
        },
      }),
    );
    expect(result).toEqual({ mode: 'baseline' });
  });
});
