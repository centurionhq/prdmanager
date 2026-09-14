/**
 * Which `@prdm/contracts` `TOKEN_SCOPES` each token kind may actually request (SDD-006 §Permisos "Scopes
 * de tokens" table, WO-119): the create-token forms only ever offer the scopes valid for that kind — the
 * server is still the real enforcement (`InvalidScopeError`), this only avoids offering a scope certain
 * to be rejected.
 */
import { TOKEN_SCOPES, type TokenScopeDto } from '@prdm/contracts';

/** Personal tokens: everything except `reports:baseline` (CI-with-OIDC only, SDD-006). */
export const PERSONAL_TOKEN_SCOPES: readonly TokenScopeDto[] = TOKEN_SCOPES.filter((scope) => scope !== 'reports:baseline');

/** CI tokens: no `/mcp` access and no `import:write` (project-admin personal action only, SDD-006). */
export const CI_TOKEN_SCOPES: readonly TokenScopeDto[] = TOKEN_SCOPES.filter(
  (scope) => scope !== 'mcp:read' && scope !== 'mcp:write' && scope !== 'import:write',
);
