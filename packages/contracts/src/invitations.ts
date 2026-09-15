/**
 * Invitation DTOs (SDD-006 §Autenticación / §Modelo de datos, WO-105).
 */
import { z } from 'zod';
import { orgRoleSchema } from './organizations.js';

export const projectInvitationGrantSchema = z.object({
  projectId: z.string().min(1),
  role: z.enum(['admin', 'editor', 'developer', 'commenter', 'viewer']),
});
export type ProjectInvitationGrant = z.infer<typeof projectInvitationGrantSchema>;

export const createOrganizationInvitationInputSchema = z.object({
  email: z.string().email(),
  role: orgRoleSchema,
  projectGrants: z.array(projectInvitationGrantSchema).optional(),
});
export type CreateOrganizationInvitationInput = z.infer<typeof createOrganizationInvitationInputSchema>;

/** `{secret}` alone is always required; `password`/`name` are only used on the new-user acceptance
 * path (an existing, already signed-in user needs neither — SDD-006: "usuario existente: exige sesión
 * con ese email más el secreto"). */
export const acceptInvitationInputSchema = z.object({
  secret: z.string().min(1),
  password: z.string().min(12).optional(),
  name: z.string().min(1).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;

/** What a listing endpoint returns — deliberately has no `secret`/`secretHash` field at all (SDD-006:
 * "Ningún listado devuelve secretos"). */
export const invitationSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  role: orgRoleSchema,
  status: z.string(),
  expiresAt: z.string(),
});
export type InvitationSummary = z.infer<typeof invitationSummarySchema>;
