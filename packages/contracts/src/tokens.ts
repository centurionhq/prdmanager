/**
 * Token DTOs (SDD-006 §Modelo de datos / §Permisos "Scopes de tokens", WO-109): shared between
 * `packages/server`'s `/api/app/tokens` (personal) and `/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens`
 * (CI) routes and (in a later WO) `packages/app`'s typed API client.
 */
import { z } from 'zod';

export const TOKEN_SCOPES = ['mcp:read', 'mcp:write', 'governance:read', 'reports:write', 'reports:baseline', 'import:write'] as const;
export const tokenScopeSchema = z.enum(TOKEN_SCOPES);
export type TokenScopeDto = z.infer<typeof tokenScopeSchema>;

export const MAX_TOKEN_TTL_DAYS = 90;

export const tokenNameSchema = z.string().min(1).max(100);

export const createPersonalTokenInputSchema = z.object({
  name: tokenNameSchema,
  scopes: z.array(tokenScopeSchema).min(1),
  /** ISO 8601; validated server-side against "now + 90 days" with the server's own clock, never the
   * client's (SDD-006: "expiración obligatoria de hasta 90 días"). */
  expiresAt: z.iso.datetime(),
  /** Optional (SDD-010 "MCP remoto": "prdm link sugiere tokens acotados con project_ids") — omitted
   * means unscoped (every project the creating user can already see); server-validated to belong to
   * the same organization, same as a CI token's. */
  projectIds: z.array(z.string()).optional(),
});
export type CreatePersonalTokenInput = z.infer<typeof createPersonalTokenInputSchema>;

export const createCiTokenInputSchema = z.object({
  name: tokenNameSchema,
  scopes: z.array(tokenScopeSchema).min(1),
  expiresAt: z.iso.datetime(),
  /** Additional project ids (beyond the project in the URL) this CI token may also act on, all within
   * the same organization — validated server-side. */
  projectIds: z.array(z.string()).default([]),
});
export type CreateCiTokenInput = z.infer<typeof createCiTokenInputSchema>;

/** Never carries a secret or its hash — only what a listing screen needs to show and let the owner
 * decide whether to revoke it. */
export const tokenSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(['personal', 'project_ci']),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TokenSummaryDto = z.infer<typeof tokenSummarySchema>;

/** Returned exactly once, on creation, alongside the summary (SDD-006: "el secreto se muestra una sola
 * vez" — WO-109's own issuance contract). */
export const createdTokenResponseSchema = z.object({
  token: tokenSummarySchema,
  secret: z.string(),
});
export type CreatedTokenResponse = z.infer<typeof createdTokenResponseSchema>;
