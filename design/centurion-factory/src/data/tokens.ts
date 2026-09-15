/**
 * CI tokens (WO-272), exactly as the table in canvas/AjustesTokens.dc.html.
 */
import type { CiToken } from './types';

export const CI_TOKENS: readonly CiToken[] = [
  {
    name: 'github-actions-main',
    prefix: 'prdm_ci_7f3a',
    scopes: ['reports:write', 'reports:baseline'],
    branch: 'main',
    createdBy: 'ana-rios',
    createdAt: '2026-09-15',
    expiresAt: '2026-12-14',
    lastUsed: '2026-09-15T09:56:00.000Z',
    expired: false,
  },
  {
    name: 'github-actions-previews',
    prefix: 'prdm_ci_c21e',
    scopes: ['reports:write'],
    branch: 'cualquier rama',
    createdBy: 'martin-sosa',
    createdAt: '2026-08-04',
    expiresAt: '2026-11-02',
    lastUsed: '2026-09-15T09:38:00.000Z',
    expired: false,
  },
  {
    name: 'github-actions-nightly',
    prefix: 'prdm_ci_19bd',
    scopes: ['governance:read'],
    branch: 'main',
    createdBy: 'ana-rios',
    createdAt: '2026-06-03',
    expiresAt: '2026-09-01',
    lastUsed: '2026-09-01T00:00:00.000Z',
    expired: true,
  },
];

export function getCiToken(name: string): CiToken | undefined {
  return CI_TOKENS.find((token) => token.name === name);
}
