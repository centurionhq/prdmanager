/**
 * Organization DTOs (SDD-006 §Modelo de datos / §Permisos, WO-104): shared between `packages/server`'s
 * `/api/app/organizations/*` routes and (in a later WO) `packages/app`'s typed API client.
 */
import { z } from 'zod';

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export const orgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const organizationSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  role: orgRoleSchema,
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const organizationMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: orgRoleSchema,
  /** ISO 8601 of this member's most recent activity in the organization, `null` if they never have;
   * optional (rather than required) so an older server response missing this SDD-012 addition still
   * parses. */
  lastActiveAt: z.string().nullable().optional(),
});
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const setActiveOrganizationInputSchema = z.object({ organizationId: z.string().min(1) });
export type SetActiveOrganizationInput = z.infer<typeof setActiveOrganizationInputSchema>;

export const updateOrgMemberRoleInputSchema = z.object({ role: orgRoleSchema });
export type UpdateOrgMemberRoleInput = z.infer<typeof updateOrgMemberRoleInputSchema>;

export const ACCESS_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const accessRequestStatusSchema = z.enum(ACCESS_REQUEST_STATUSES);
export type AccessRequestStatus = z.infer<typeof accessRequestStatusSchema>;

/** Topes del POST público (SDD-099 D2 — el mensaje es un pedido, no un documento). */
export const ACCESS_REQUEST_NAME_MAX_LENGTH = 120;
export const ACCESS_REQUEST_MESSAGE_MAX_LENGTH = 2000;

export const createAccessRequestInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(ACCESS_REQUEST_NAME_MAX_LENGTH).optional(),
  message: z.string().trim().min(1).max(ACCESS_REQUEST_MESSAGE_MAX_LENGTH).optional(),
});
export type CreateAccessRequestInput = z.infer<typeof createAccessRequestInputSchema>;

/** The DTO never exposes `orgId`: the client never sends it, the server resolves it from the slug. */
export const accessRequestSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  message: z.string().nullable(),
  status: accessRequestStatusSchema,
  /** ISO 8601 */
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
});
export type AccessRequest = z.infer<typeof accessRequestSchema>;

export const accessRequestListSchema = z.object({ requests: z.array(accessRequestSchema) });
export type AccessRequestList = z.infer<typeof accessRequestListSchema>;
