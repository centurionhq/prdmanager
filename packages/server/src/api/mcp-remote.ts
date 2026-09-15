/**
 * `POST /mcp/:graphProjectId` and `POST /mcp` (SDD-010 "MCP remoto", WO-184): the remote MCP surface a
 * developer's code assistant talks to, over `StreamableHTTPServerTransport` (SDK 1.30.0) in **stateless**
 * mode (`sessionIdGenerator: undefined` — the SDK itself requires a fresh transport per request in this
 * mode, confirmed by `packages/server/tests/learning/mcp-streamable-http.test.ts`, ADR-006/WO-084).
 *
 * Auth chain, cheapest/least-sensitive first:
 *  1. `Authorization: Bearer prdm_pat_...` resolved via the SDD-006 `SECURITY DEFINER` `resolve_token`
 *     function (`requireBearerToken`, the same Bearer plugin every other `/api/v1/*` route uses) — any
 *     valid, unexpired, unrevoked token (`{ kind: 'bearer', scope: 'any' }` at the route-access layer;
 *     the actual `mcp:read`/`mcp:write` scopes are enforced per tool call below, since a single batched
 *     JSON-RPC request can mix tools with different scope requirements).
 *  2. `token.kind !== 'personal'` (a `project_ci` token) is rejected outright — SDD-010: "los tokens de
 *     CI no acceden a /mcp" (CI tokens can never hold `mcp:*` scopes anyway, but this rejects even a
 *     `tools/list` with no tool call at all).
 *  3. `graphProjectId` resolved through `resolveProjectByGraphProjectId` (pre-tenant, IDOR-safe) →
 *     the token's own org must own it; a token scoped to specific `project_ids` must include it.
 *  4. The calling user's actual project role is resolved (org owner/admin inherits project admin,
 *     otherwise their `project_members` row) — no row at all (and not an org admin) is the same 404 as
 *     a nonexistent project.
 *  5. `Origin`, when present, must be in `env.trustedOrigins` (no cookies/CSRF on this route at all —
 *     this is a courtesy defense-in-depth check for browser-originated requests, not the primary
 *     control).
 *
 * Every tool call (read or write, and every call inside a batched JSON-RPC request) is (a) counted
 * against a per-token rate limit and (b) audited by name — both implemented by wrapping
 * `server.registerTool`/`registerResource`/`registerPrompt` (`instrumentMcpCalls`) before handing the server to
 * `registerPrdmTools`/`registerRemoteWriteTools`, so neither of those (nor any individual tool file)
 * needs to know this is happening.
 *
 * `GET`/`DELETE` on either path answer `405` by hand, never reaching the transport (which would
 * otherwise open an SSE stream for `GET`) — same as the learning test's own confirmed shape.
 * `/mcp` with no project id exposes only `list_projects`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerPrdmTools, registerRemoteWriteTools, type PrdmDeps, type RemoteWriteAuth } from '@prdm/mcp/lib';
import { can, type PermissionSubject } from '@prdm/contracts';
import { createTenantDb, findMembership, findUserProfile, resolveProjectByGraphProjectId, type OrgRole, type ProjectRecord } from '@prdm/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Neo4jGraphDatabase } from '@prdm/core';
import { isOrgAdmin } from './projects.js';
import { rejectUntrustedOrigin } from './trusted-origin.js';
import { buildPrdmConfig } from '../engine/pg-project-settings.js';
import { resolvePgProjectEngine } from '../engine/resolve-pg-project-engine.js';
import type { RequestToken } from '../auth/bearer-auth.js';
import type { McpToolRateLimiter } from '../rate-limit/mcp-tool-rate-limits.js';

const METHOD_NOT_ALLOWED_BODY = { jsonrpc: '2.0' as const, error: { code: -32000, message: 'Method not allowed.' }, id: null };

/** SDD-010 doesn't pin an exact number here — a judgment call, generous enough for a normal
 * implement-a-work-order session, tight enough to bound abuse of a single leaked token. */
export const DEFAULT_MCP_TOOL_RATE_LIMIT_PER_MINUTE = 120;

function readServerVersion(): string {
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

/** Read once at process startup, not per request (SDD-010, WO-184). */
const SERVER_VERSION = readServerVersion();

export interface RegisterMcpRemoteRoutesOptions {
  pool: Pool;
  neo4j?: Neo4jGraphDatabase;
  rateLimiter: McpToolRateLimiter;
}

interface McpRouteParams {
  graphProjectId: string;
}

function sendMethodNotAllowed(reply: FastifyReply): void {
  void reply.code(405).send(METHOD_NOT_ALLOWED_BODY);
}

/**
 * Wraps every `server.registerTool`/`registerResource`/`registerPrompt` call (WO-184's original
 * `instrumentToolCalls`, extended by WO-232) so each individual invocation — including every message
 * inside a batched JSON-RPC array, since the transport dispatches each one through this same registered
 * handler — runs `beforeCall(name)` first. `resources/read` and `prompts/get` previously bypassed this
 * entirely (only `registerTool` was ever patched), so a scope-less token or one over its rate limit could
 * read any resource or fetch any prompt with zero audit trail — the exact gap this closes.
 *
 * Returning a `CallToolResult` from `beforeCall` short-circuits a *tool* call with that result (its
 * `isError`/`structuredContent` shape is meaningful there). Resources and prompts have no equivalent
 * "error content" shape in the MCP spec, so the same denial is instead surfaced by throwing an `McpError`
 * — exactly how the SDK's own built-in "not found"/"disabled" checks already reject a `resources/read` or
 * `prompts/get` (see `ReadResourceRequestSchema`/`GetPromptRequestSchema` handlers in the installed SDK).
 *
 * Also installs a tripwire on the SDK's alternate `tool`/`resource`/`prompt` registration aliases (as
 * opposed to `registerTool`/`registerResource`/`registerPrompt`): nothing in this codebase calls them
 * today, but they bypass this wrapper entirely (they're independent implementations, not thin wrappers
 * over the `register*` methods), so calling them by mistake in the future would silently reintroduce this
 * exact bug. Throwing here turns that mistake into an immediate, loud failure instead.
 *
 * Deliberately loosely typed at the boundary (the SDK's public signatures are complex generic overloads
 * not worth reproducing for a cross-cutting instrumentation wrapper) — the *runtime* shape (name, ...,
 * handler) is exactly what every call site in `@prdm/mcp` already passes.
 */
type LooseRegisterFn = (...args: unknown[]) => unknown;

function deniedResourceOrPromptError(denied: CallToolResult): McpError {
  const data = denied.structuredContent as { error: string; message: string } | undefined;
  return new McpError(ErrorCode.InvalidRequest, data?.message ?? data?.error ?? 'denied');
}

function bypassAliasError(alias: string, registerName: string): never {
  throw new Error(`McpServer.${alias}() bypasses MCP audit/scope/rate-limit instrumentation — use ${registerName} instead (WO-232)`);
}

/** Exported only for `mcp-remote-instrumentation.test.ts`'s focused unit coverage of the tripwire (the
 * `tool`/`resource`/`prompt` aliases can't be exercised through the full HTTP route, since nothing in
 * this codebase calls them — that's the whole point of the tripwire). */
export function instrumentMcpCalls(server: McpServer, beforeCall: (name: string) => Promise<CallToolResult | undefined>): void {
  const target = server as unknown as Record<string, LooseRegisterFn>;

  function wrapRegistration(methodName: string, handlerArgIndex: number, onDenied: (denied: CallToolResult) => unknown): void {
    const original = target[methodName]!.bind(target);
    target[methodName] = (...args: unknown[]) => {
      const name = args[0] as string;
      const handler = args[handlerArgIndex] as (...handlerArgs: unknown[]) => unknown;
      const wrapped = async (...handlerArgs: unknown[]) => {
        const denied = await beforeCall(name);
        if (denied) return onDenied(denied);
        return handler(...handlerArgs);
      };
      const patchedArgs = [...args];
      patchedArgs[handlerArgIndex] = wrapped;
      return original(...patchedArgs);
    };
  }

  // `registerTool(name, config, cb)`, `registerPrompt(name, config, cb)`: handler is argument index 2.
  wrapRegistration('registerTool', 2, (denied) => denied);
  wrapRegistration('registerPrompt', 2, (denied) => {
    throw deniedResourceOrPromptError(denied);
  });
  // `registerResource(name, uriOrTemplate, config, readCallback)`: handler is argument index 3.
  wrapRegistration('registerResource', 3, (denied) => {
    throw deniedResourceOrPromptError(denied);
  });

  target.tool = () => bypassAliasError('tool', 'registerTool');
  target.resource = () => bypassAliasError('resource', 'registerResource');
  target.prompt = () => bypassAliasError('prompt', 'registerPrompt');
}

function rateLimitedResult(): CallToolResult {
  const data = { error: 'rate_limited', message: 'too many tool calls for this token' };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

/** The only three tools this route ever registers via `registerRemoteWriteTools` — everything else
 * `registerPrdmTools({ profile: 'remote' })` registers is read-only per SDD-010's own table. */
const REMOTE_WRITE_TOOL_NAMES = new Set(['claim_work_order', 'complete_work_order', 'submit_feedback']);

function missingScopeResult(scope: string): CallToolResult {
  const data = { error: 'missing_scope', message: `this token does not carry the ${scope} scope` };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

interface McpAuthContext {
  token: RequestToken;
  orgId: string;
  userId: string;
  orgRole: OrgRole;
}

/** Resolves step 2 (personal-token-only) and the org half of step 4 of this module's own doc comment,
 * or `null`/`'wrong_token_kind'` for any failure — every failure maps to the same 404 (IDOR-safe) or
 * 403 (wrong token kind) at the call site, never a distinguishing signal. */
async function resolveMcpAuth(pool: Pool, token: RequestToken): Promise<McpAuthContext | 'wrong_token_kind' | null> {
  if (token.kind !== 'personal' || !token.userId) return 'wrong_token_kind';
  const membership = await findMembership(pool, token.orgId, token.userId);
  if (!membership) return null;
  return { token, orgId: token.orgId, userId: token.userId, orgRole: membership.role };
}

/** The project half of step 4: an org owner/admin inherits project admin (SDD-006 §Permisos); anyone
 * else needs their own `project_members` row. */
async function resolveProjectSubject(pool: Pool, orgId: string, projectId: string, auth: McpAuthContext): Promise<PermissionSubject | null> {
  if (isOrgAdmin(auth.orgRole)) return { orgRole: auth.orgRole };
  const membership = await createTenantDb(pool).forOrg(orgId).forProject(projectId).members.findForUser(auth.userId);
  if (!membership) return null;
  return { orgRole: auth.orgRole, projectRole: membership.role };
}

async function auditToolCall(pool: Pool, orgId: string, projectId: string | undefined, token: RequestToken, toolName: string): Promise<void> {
  await createTenantDb(pool)
    .forOrg(orgId)
    .auditLog.record({
      projectId,
      actorType: 'token',
      actorId: token.tokenId,
      action: 'mcp.tool_call',
      target: toolName,
      metadata: { tool: toolName },
    });
}

async function buildRemoteDeps(pool: Pool, neo4j: Neo4jGraphDatabase, orgId: string, project: ProjectRecord): Promise<PrdmDeps> {
  const engine = resolvePgProjectEngine(pool, neo4j, orgId, project);
  return { config: buildPrdmConfig(project), store: engine.store, engine };
}

async function handleProjectMcpPost(req: FastifyRequest<{ Params: McpRouteParams }>, reply: FastifyReply, opts: RegisterMcpRemoteRoutesOptions): Promise<void> {
  const { pool, neo4j, rateLimiter } = opts;
  const token = req.token!;

  if (rejectUntrustedOrigin(req, reply)) return;

  const auth = await resolveMcpAuth(pool, token);
  if (auth === 'wrong_token_kind') {
    void reply.code(403).send({ error: 'ci_tokens_cannot_use_mcp' });
    return;
  }
  if (!auth) {
    void reply.code(404).send();
    return;
  }

  const resolved = await resolveProjectByGraphProjectId(pool, req.params.graphProjectId);
  if (!resolved || resolved.orgId !== auth.orgId) {
    void reply.code(404).send();
    return;
  }
  if (token.projectIds && !token.projectIds.includes(resolved.projectId)) {
    void reply.code(404).send();
    return;
  }

  const project = await createTenantDb(pool).forOrg(resolved.orgId).forProject(resolved.projectId).get();
  if (!project) {
    void reply.code(404).send();
    return;
  }

  const subject = await resolveProjectSubject(pool, resolved.orgId, resolved.projectId, auth);
  if (!subject || !can(subject, 'view')) {
    void reply.code(404).send();
    return;
  }

  if (!neo4j) throw new Error('graph store not configured for this server instance');
  const deps = await buildRemoteDeps(pool, neo4j, resolved.orgId, project);

  // A missing `user_profile` row (should never happen for a real signed-up user — see
  // `register-auth.ts`'s own hook — but defensive rather than 404ing an otherwise-legitimate
  // connection over it) just means no `dev:<handle>` assignee will ever match this caller; every other
  // tool is unaffected.
  const profile = await findUserProfile(pool, auth.userId);

  const server = new McpServer({ name: 'prdm-graph-remote', version: SERVER_VERSION });
  const remoteAuth: RemoteWriteAuth = {
    subject,
    scopes: token.scopes,
    callerHandle: profile?.handle ?? '',
    audit: async (action, target, metadata) => {
      await createTenantDb(pool)
        .forOrg(resolved.orgId)
        .auditLog.record({
          projectId: resolved.projectId,
          actorType: 'user',
          actorId: auth.userId,
          action,
          target,
          metadata,
        });
    },
  };

  instrumentMcpCalls(server, async (toolName) => {
    const requiredScope = REMOTE_WRITE_TOOL_NAMES.has(toolName) ? 'mcp:write' : 'mcp:read';
    if (!token.scopes.includes(requiredScope)) return missingScopeResult(requiredScope);
    const allowed = await rateLimiter.check(req, token.tokenId);
    if (!allowed) return rateLimitedResult();
    await auditToolCall(pool, resolved.orgId, resolved.projectId, token, toolName);
    return undefined;
  });

  registerPrdmTools(server, deps, { profile: 'remote' });
  registerRemoteWriteTools(server, deps, remoteAuth);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.hijack();
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });
}

function registerListProjectsTool(server: McpServer, pool: Pool, auth: McpAuthContext, token: RequestToken): void {
  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: "Lists the projects this token's organization owns that it can access — every project when the token isn't scoped to specific project_ids, otherwise only those.",
      inputSchema: {},
      annotations: { title: 'List projects', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const tenantDb = createTenantDb(pool).forOrg(auth.orgId);
      const projects = isOrgAdmin(auth.orgRole) ? await tenantDb.projects.list() : await tenantDb.projects.listForUser(auth.userId);
      const visible = token.projectIds ? projects.filter((p) => token.projectIds!.includes(p.id)) : projects;
      const data = { projects: visible.map((p) => ({ id: p.graphProjectId, name: p.name, slug: p.slug })) };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
    },
  );
}

async function handleBareMcpPost(req: FastifyRequest, reply: FastifyReply, opts: RegisterMcpRemoteRoutesOptions): Promise<void> {
  const { pool, rateLimiter } = opts;
  const token = req.token!;

  if (rejectUntrustedOrigin(req, reply)) return;

  const auth = await resolveMcpAuth(pool, token);
  if (auth === 'wrong_token_kind') {
    void reply.code(403).send({ error: 'ci_tokens_cannot_use_mcp' });
    return;
  }
  if (!auth) {
    void reply.code(404).send();
    return;
  }

  const server = new McpServer({ name: 'prdm-graph-remote', version: SERVER_VERSION });
  instrumentMcpCalls(server, async (toolName) => {
    if (!token.scopes.includes('mcp:read')) return missingScopeResult('mcp:read');
    const allowed = await rateLimiter.check(req, token.tokenId);
    if (!allowed) return rateLimitedResult();
    await auditToolCall(pool, auth.orgId, undefined, token, toolName);
    return undefined;
  });
  registerListProjectsTool(server, pool, auth, token);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.hijack();
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });
}

export function registerMcpRemoteRoutes(app: FastifyInstance, opts: RegisterMcpRemoteRoutesOptions): void {
  app.post<{ Params: McpRouteParams }>('/mcp/:graphProjectId', { config: { access: { kind: 'bearer', scope: 'any' } } }, (req, reply) =>
    handleProjectMcpPost(req, reply, opts),
  );
  app.get('/mcp/:graphProjectId', { config: { access: { kind: 'bearer', scope: 'any' } } }, (_req, reply) => sendMethodNotAllowed(reply));
  app.delete('/mcp/:graphProjectId', { config: { access: { kind: 'bearer', scope: 'any' } } }, (_req, reply) => sendMethodNotAllowed(reply));

  app.post('/mcp', { config: { access: { kind: 'bearer', scope: 'any' } } }, (req, reply) => handleBareMcpPost(req, reply, opts));
  app.get('/mcp', { config: { access: { kind: 'bearer', scope: 'any' } } }, (_req, reply) => sendMethodNotAllowed(reply));
  app.delete('/mcp', { config: { access: { kind: 'bearer', scope: 'any' } } }, (_req, reply) => sendMethodNotAllowed(reply));
}
