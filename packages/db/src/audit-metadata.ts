/**
 * A pure guard for `audit_log`/`platform_audit_log`'s `metadata` column (SDD-006 §Modelo de datos:
 * "metadata sin secretos"; §Cabeceras: "ni tokens de reseteo, invitación o Bearer aparecen ... en
 * metadata de auditoría"). Throws — rather than silently stripping — so a caller that almost logged a
 * secret fails loudly in tests instead of shipping a redaction bug unnoticed.
 *
 * Not exhaustive by design (this is defense in depth, not the only safeguard): it rejects the key
 * *names* SDD-006 calls out by name (token, password, cookie, authorization) plus the closely related
 * `secret`/`api key` family, and the *value shapes* prdm itself issues as secrets — `Bearer <...>`
 * headers, JWT-shaped strings, and prdm's own token prefixes (`prdm_pat_`/`prdm_ci_`, SDD-006
 * §Modelo de datos).
 */
const SECRET_KEY_PATTERN = /token|password|secret|cookie|authoriz[a-z]*|api[_-]?key/i;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^bearer\s+\S+/i,
  // JWT-shaped: three base64url segments separated by dots.
  /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/,
  /^prdm_(pat|ci)_/i,
];

export class AuditMetadataSecretError extends Error {
  constructor(public readonly path: string) {
    super(`audit metadata at "${path}" looks like a secret and must not be logged`);
    this.name = 'AuditMetadataSecretError';
  }
}

function looksLikeSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function checkValue(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (looksLikeSecretValue(value)) throw new AuditMetadataSecretError(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    assertNoSecretsInAuditMetadata(value as Record<string, unknown>, path);
  }
}

/**
 * Recursively rejects any key whose name looks like a secret, and any string value (at any depth,
 * including inside arrays) that looks like a secret. `path` is only used to build error messages for
 * nested calls; callers pass metadata at the top level.
 */
export function assertNoSecretsInAuditMetadata(metadata: Record<string, unknown>, path = ''): void {
  for (const [key, value] of Object.entries(metadata)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY_PATTERN.test(key)) throw new AuditMetadataSecretError(currentPath);
    checkValue(value, currentPath);
  }
}
