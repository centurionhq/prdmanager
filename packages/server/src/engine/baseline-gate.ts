/**
 * The baseline-mode gate (SDD-010 "Modo baseline de code-reports", WO-181): decides whether a
 * `code-report` (WO-180) earns **baseline** trust (writes `commits`/`project_code_state`, triggers
 * `PgProjectEngine.refresh()`) or stays a **preview** (pure `detectDrift`, no writes) — or, for the one
 * case that must be a loud, actionable failure rather than a silent downgrade, is outright **rejected**.
 *
 * All of the following must hold for baseline mode (SDD-010, in the order checked — cheapest and least
 * sensitive first, so a request that was never going to qualify never even reaches OIDC verification,
 * which would otherwise burn a single-use `jti` for nothing):
 *  1. `reports:baseline` scope — a CI-only scope (`ALLOWED_SCOPES_BY_KIND`, `@prdm/db`); a personal
 *     token can never carry it at all, so a feature-branch developer's own token silently falls to
 *     preview here without ever needing a distinct check.
 *  2. The project's `settings` actually captured a `github_repository_id`/`github_owner_id` at
 *     configuration time (nothing to verify an OIDC token's repository claims against otherwise).
 *  3. `client.hash_algo_version` matches `settings.hash_algo_version` exactly.
 *  4. An OIDC token is attached, and {@link verifyGithubActionsOidc} (WO-179) accepts it against this
 *     project's captured `repository_id`/`repository_owner_id`/`default_branch` and the report's own
 *     `head_sha`.
 *
 * Any failure in 1-4 is a **silent** fall to preview (SDD-010's own wording: a feature-branch token
 * "debe caer silenciosamente a vista previa, no fallar confusamente") — the request as a whole still
 * succeeds; it just never becomes official. Only the fifth, distinct check — `head_sha` regressing
 * behind the project's registered baseline head without a matching, un-consumed
 * `force_push_overrides` row — is an explicit **rejection**: this is the one scenario where "just treat
 * it as a preview" would silently mask a legitimate CI pipeline believing its default-branch push
 * updated the official baseline when it didn't.
 */
import type { OidcJtiStore } from '@prdm/db';
import type { CodeReportRequest, ProjectSettings } from '@prdm/contracts';
import type { JWTVerifyGetKey } from 'jose';
import { GithubOidcVerificationError, verifyGithubActionsOidc } from '../auth/github-oidc.js';

export interface BaselineGateTokenInput {
  kind: 'personal' | 'project_ci';
  scopes: readonly string[];
}

export interface BaselineGateDeps {
  githubOidcJwks: JWTVerifyGetKey;
  oidcJtiStore: OidcJtiStore;
  now: () => Date;
  publicUrl: string;
  /** Consumes (deletes) the admin override for `(projectId, headSha)`, if one exists; `true` means one
   * was actually consumed. Only ever called once every other baseline criterion already holds. */
  consumeForcePushOverride: (headSha: string) => Promise<boolean>;
}

export type BaselineGateResult = { mode: 'preview' } | { mode: 'baseline' } | { mode: 'rejected'; code: 'force_push_requires_admin_override' };

export interface EvaluateBaselineGateInput {
  token: BaselineGateTokenInput;
  oidcToken: string | undefined;
  settings: ProjectSettings;
  report: CodeReportRequest;
  /** The project's currently registered baseline head (`project_code_state.latest_baseline_head_sha`),
   * or `null` before its first-ever baseline report. */
  registeredBaselineHeadSha: string | null;
  deps: BaselineGateDeps;
}

/**
 * A `head_sha` "regresses" when the project already has a registered baseline head that is neither the
 * new `head_sha` itself nor found among the newly reported `commits[]` — i.e. the new report's own
 * commit history (as it reported it) does not contain the previously-registered head, so it cannot be
 * a fast-forward of it. `CodeReportRequest.commits` carries no parent-chain data (only `sha`/`author`/
 * `date`/`subject`/`refs`/`files`, see `@prdm/contracts`), so this is a deliberately conservative
 * approximation of "ancestor of" rather than a true DAG walk — flagged for the security review as a
 * point worth re-checking against a richer commit-graph representation in a later phase.
 */
function isHeadRegression(report: CodeReportRequest, registeredBaselineHeadSha: string | null): boolean {
  if (registeredBaselineHeadSha === null) return false;
  if (registeredBaselineHeadSha === report.head_sha) return false;
  return !report.commits.some((commit) => commit.sha === registeredBaselineHeadSha);
}

export async function evaluateBaselineGate(input: EvaluateBaselineGateInput): Promise<BaselineGateResult> {
  const { token, oidcToken, settings, report, registeredBaselineHeadSha, deps } = input;

  if (token.kind !== 'project_ci' || !token.scopes.includes('reports:baseline')) return { mode: 'preview' };
  if (!settings.github_repository_id || !settings.github_owner_id) return { mode: 'preview' };
  if (report.client.hash_algo_version !== settings.hash_algo_version) return { mode: 'preview' };
  if (!oidcToken) return { mode: 'preview' };

  try {
    await verifyGithubActionsOidc({
      token: oidcToken,
      jwks: deps.githubOidcJwks,
      jtiStore: deps.oidcJtiStore,
      now: deps.now,
      audience: deps.publicUrl,
      expectedRepositoryId: String(settings.github_repository_id),
      expectedRepositoryOwnerId: String(settings.github_owner_id),
      expectedDefaultBranch: settings.default_branch,
      expectedHeadSha: report.head_sha,
    });
  } catch (err) {
    if (err instanceof GithubOidcVerificationError) return { mode: 'preview' };
    throw err;
  }

  if (isHeadRegression(report, registeredBaselineHeadSha)) {
    const overridden = await deps.consumeForcePushOverride(report.head_sha);
    if (!overridden) return { mode: 'rejected', code: 'force_push_requires_admin_override' };
  }

  return { mode: 'baseline' };
}
