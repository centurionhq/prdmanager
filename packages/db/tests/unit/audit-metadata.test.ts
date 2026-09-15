import { describe, expect, test } from 'vitest';
import { assertNoSecretsInAuditMetadata, AuditMetadataSecretError } from '../../src/audit-metadata.js';

describe('assertNoSecretsInAuditMetadata', () => {
  test('allows ordinary metadata', () => {
    expect(() => assertNoSecretsInAuditMetadata({ action: 'project.create', slug: 'roadmap', count: 3 })).not.toThrow();
  });

  test.each(['token', 'accessToken', 'password', 'newPassword', 'cookie', 'Authorization', 'apiKey', 'api_key', 'secret'])(
    'rejects a key named "%s" regardless of its value',
    (key) => {
      expect(() => assertNoSecretsInAuditMetadata({ [key]: 'harmless-looking-value' })).toThrow(AuditMetadataSecretError);
    },
  );

  test('rejects a Bearer-shaped value under an innocuous key', () => {
    expect(() => assertNoSecretsInAuditMetadata({ header: 'Bearer abc123.def456' })).toThrow(/looks like a secret/);
  });

  test('rejects a JWT-shaped value under an innocuous key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(() => assertNoSecretsInAuditMetadata({ note: jwt })).toThrow(/looks like a secret/);
  });

  test('rejects prdm\'s own token prefixes', () => {
    expect(() => assertNoSecretsInAuditMetadata({ note: 'prdm_pat_abcdef0123456789' })).toThrow(/looks like a secret/);
    expect(() => assertNoSecretsInAuditMetadata({ note: 'prdm_ci_abcdef0123456789' })).toThrow(/looks like a secret/);
  });

  test('recurses into nested objects and arrays', () => {
    expect(() => assertNoSecretsInAuditMetadata({ request: { headers: { authorization: 'Bearer x' } } })).toThrow(
      /request\.headers\.authorization/,
    );
    expect(() => assertNoSecretsInAuditMetadata({ list: [{ password: 'x' }] })).toThrow(/list\[0\]\.password/);
  });

  test('does not flag unrelated words that merely contain a substring like "secretary"', () => {
    expect(() => assertNoSecretsInAuditMetadata({ role: 'secretary' })).not.toThrow();
  });
});
