/**
 * Token-summary DTO validation (SDD-012, WO-327): `createdByName` lets the CI-token list screen show
 * who created a shared project credential without a second round-trip.
 */
import { describe, expect, test } from 'vitest';
import { tokenSummarySchema } from '../../src/tokens.js';

describe('tokenSummarySchema', () => {
  const valid = {
    id: 'token-1',
    kind: 'project_ci' as const,
    name: 'GitHub Actions',
    prefix: 'prdm_ci_ab12',
    scopes: ['reports:write'],
    expiresAt: '2026-12-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    createdByName: 'Ada Lovelace',
  };

  test('accepts a CI token with its creator name', () => {
    expect(tokenSummarySchema.parse(valid)).toEqual(valid);
  });

  test('accepts a null createdByName (creator account deleted)', () => {
    expect(tokenSummarySchema.parse({ ...valid, createdByName: null }).createdByName).toBeNull();
  });

  test('may omit createdByName entirely (older server response)', () => {
    const { createdByName: _createdByName, ...withoutCreatedByName } = valid;
    expect(tokenSummarySchema.parse(withoutCreatedByName).createdByName).toBeUndefined();
  });
});
