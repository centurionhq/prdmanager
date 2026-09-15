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
});
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const setActiveOrganizationInputSchema = z.object({ organizationId: z.string().min(1) });
export type SetActiveOrganizationInput = z.infer<typeof setActiveOrganizationInputSchema>;

export const updateOrgMemberRoleInputSchema = z.object({ role: orgRoleSchema });
export type UpdateOrgMemberRoleInput = z.infer<typeof updateOrgMemberRoleInputSchema>;
