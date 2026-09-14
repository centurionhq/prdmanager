/**
 * Personal and project-CI API tokens (SDD-006 §Modelo de datos / §Permisos "Scopes de tokens", WO-109;
 * dashboard screens WO-119). `secret` is only ever present on the create response, exactly once.
 */
import type { CreateCiTokenInput, CreatePersonalTokenInput, CreatedTokenResponse, TokenSummaryDto } from '@prdm/contracts';
import { request } from './request.js';

export function listPersonalTokens(orgSlug: string): Promise<TokenSummaryDto[]> {
  return request<{ tokens: TokenSummaryDto[] }>(`/api/app/tokens?orgSlug=${encodeURIComponent(orgSlug)}`).then((r) => r.tokens);
}

export function createPersonalToken(orgSlug: string, input: CreatePersonalTokenInput): Promise<CreatedTokenResponse> {
  return request('/api/app/tokens', { method: 'POST', body: { orgSlug, ...input } });
}

export function revokePersonalToken(orgSlug: string, tokenId: string): Promise<void> {
  return request(`/api/app/tokens/${encodeURIComponent(tokenId)}/revoke?orgSlug=${encodeURIComponent(orgSlug)}`, { method: 'POST' }).then(
    () => undefined,
  );
}

function ciTokensBase(orgSlug: string, projectSlug: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/ci-tokens`;
}

export function listCiTokens(orgSlug: string, projectSlug: string): Promise<TokenSummaryDto[]> {
  return request<{ tokens: TokenSummaryDto[] }>(ciTokensBase(orgSlug, projectSlug)).then((r) => r.tokens);
}

export function createCiToken(orgSlug: string, projectSlug: string, input: CreateCiTokenInput): Promise<CreatedTokenResponse> {
  return request(ciTokensBase(orgSlug, projectSlug), { method: 'POST', body: input });
}

export function revokeCiToken(orgSlug: string, projectSlug: string, tokenId: string): Promise<void> {
  return request(`${ciTokensBase(orgSlug, projectSlug)}/${encodeURIComponent(tokenId)}/revoke`, { method: 'POST' }).then(() => undefined);
}
