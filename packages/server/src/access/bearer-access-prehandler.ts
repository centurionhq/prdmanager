/**
 * Global Bearer-scope enforcement (SDD-006 §Permisos "Scopes de tokens", WO-110): a single `preHandler`
 * hook, driven entirely by each route's own `config.access` (`./route-access.js`), so no individual
 * route handler needs to call `requireBearerToken` itself — `GET /api/v1/me` (WO-109) is the first
 * consumer, any future `/api/v1/*` route only needs to declare `{ kind: 'bearer', scope }` and read
 * `request.token`.
 *
 * Enforcement order, cheapest checks first:
 *  1. `public`/`session` access: no-op (session routes gate themselves via `requireAppSession` inside
 *     their own handler; this hook only ever touches `bearer` access).
 *  2. {@link requireBearerToken}: format, checksum, DB resolution, expiry/revocation, cookie rejection,
 *     rate limiting on failure — sets `request.token` on success.
 *  3. `scope === 'any'`: any valid token of any kind satisfies the route (e.g. `GET /api/v1/me`).
 *  4. Otherwise, the SDD-006 §Permisos scope table, enforced twice: `assertScopeAllowedForKind` rejects
 *     a scope that token kind can never legitimately hold at all (CI tokens never get `mcp:*`/
 *     `import:write`; personal tokens never get `reports:baseline`) even if the stored `scopes` array
 *     were ever wrong; then the ordinary "does this specific token actually carry the route's required
 *     scope" check.
 *
 * `assertBearerCan` is exported for a future scope-plus-role route (SDD-010's MCP tools, SDD-007's
 * document actions): a personal token acts on behalf of its `userId`, whose *current* org/project role
 * can be stricter than what the token's own scopes allow (SDD-006: "el permiso efectivo es scope ∩
 * rol") — call it once the route has resolved that user's `PermissionSubject` for the resource in
 * question, after this hook's scope check has already passed.
 */
import { can, type PermissionAction, type PermissionSubject } from '@prdm/contracts';
import { ALLOWED_SCOPES_BY_KIND, type TokenKind, type TokenScope } from '@prdm/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireBearerToken, type RequireBearerTokenOptions } from '../auth/bearer-auth.js';
import { ForbiddenError } from '../errors.js';
import { isBearerAccess } from './route-access.js';

export function assertScopeAllowedForKind(kind: TokenKind, scope: TokenScope): void {
  if (!ALLOWED_SCOPES_BY_KIND[kind].includes(scope)) {
    throw new ForbiddenError(`scope ${scope} is not allowed for ${kind} tokens`);
  }
}

/** SDD-006 §Permisos: "el permiso efectivo es scope ∩ rol" — the scope check alone (this file) is
 * necessary but not sufficient; a caller with the right scope can still lack the underlying role. */
export function assertBearerCan(subject: PermissionSubject, action: PermissionAction): void {
  if (!can(subject, action)) throw new ForbiddenError();
}

export function installBearerAccessPreHandler(app: FastifyInstance, opts: RequireBearerTokenOptions): void {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const access = req.routeOptions.config.access;
    if (!access || !isBearerAccess(access)) return;

    const token = await requireBearerToken(req, opts);
    if (access.scope === 'any') return;

    assertScopeAllowedForKind(token.kind, access.scope);
    if (!token.scopes.includes(access.scope)) {
      throw new ForbiddenError(`token does not carry the ${access.scope} scope`);
    }
  });
}
