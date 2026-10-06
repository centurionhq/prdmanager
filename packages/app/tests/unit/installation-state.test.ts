/**
 * WO-569 (SDD-055/PRD-033 R4): what the server can actually know about a developer's setup -- a credential
 * that works, and whether anything ever authenticated with it. Nothing else is knowable from here.
 */
import { describe, expect, it } from 'vitest';
import type { TokenSummaryDto } from '@prdm/contracts';
import { installationState, isUsableMcpCredential } from '../../src/routes/construir/installation-state.js';

function token(overrides: Partial<TokenSummaryDto> = {}): TokenSummaryDto {
  return {
    id: 't1',
    kind: 'personal',
    name: 'mi portátil',
    prefix: 'prdm_ab',
    scopes: ['mcp:read', 'mcp:write'],
    expiresAt: '2099-01-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-09-20T00:00:00.000Z');

describe('installationState (WO-569)', () => {
  it('with no credential at all, nothing is done and the first step is the one to do', () => {
    const state = installationState([], NOW);
    expect(state).toMatchObject({ hasCredential: false, everConnected: false, currentStep: 'credencial' });
  });

  it('a usable credential is a live personal one that can read and write over MCP', () => {
    expect(isUsableMcpCredential(token(), NOW)).toBe(true);
    expect(isUsableMcpCredential(token({ revokedAt: '2026-05-01T00:00:00.000Z' }), NOW)).toBe(false);
    expect(isUsableMcpCredential(token({ expiresAt: '2026-01-01T00:00:00.000Z' }), NOW)).toBe(false);
    expect(isUsableMcpCredential(token({ scopes: ['mcp:read'] }), NOW)).toBe(false);
    expect(isUsableMcpCredential(token({ scopes: ['governance:read', 'reports:write'] }), NOW)).toBe(false);
    expect(isUsableMcpCredential(token({ kind: 'project_ci' }), NOW)).toBe(false);
  });

  it('with a credential that was never used, the step to do is linking the repository', () => {
    const state = installationState([token()], NOW);
    expect(state).toMatchObject({ hasCredential: true, everConnected: false, currentStep: 'vincular' });
  });

  it('once something connected with it, the installation is done and no step is pending', () => {
    const state = installationState([token({ lastUsedAt: '2026-09-19T10:00:00.000Z' })], NOW);
    expect(state).toMatchObject({ hasCredential: true, everConnected: true, currentStep: null });
  });

  it('a used but revoked credential does not count as connected: it no longer works', () => {
    const state = installationState([token({ lastUsedAt: '2026-09-19T10:00:00.000Z', revokedAt: '2026-09-19T11:00:00.000Z' })], NOW);
    expect(state).toMatchObject({ hasCredential: false, everConnected: false, currentStep: 'credencial' });
  });

  it('takes the best of several credentials, not the first one it finds', () => {
    const tokens = [token({ id: 'a', revokedAt: '2026-05-01T00:00:00.000Z' }), token({ id: 'b' }), token({ id: 'c', lastUsedAt: '2026-09-19T10:00:00.000Z' })];
    expect(installationState(tokens, NOW)).toMatchObject({ hasCredential: true, everConnected: true });
  });
});
