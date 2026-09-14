/**
 * Creates the invitation for a newly-created organization's owner (SDD-006 §Autenticación, WO-101).
 *
 * WO-101 landed the organization-creation half of the "superadmin creates an org by inviting its owner"
 * flow with a placeholder link; WO-105 extended `./create-organization-invitation.ts` with the real
 * one-time secret and `/invite/:id#s=<secret>` fragment link and made this function a thin wrapper
 * around it — this file's signature and its one call site (`../api/admin-organizations.ts`) never
 * changed.
 */
import type { Pool } from 'pg';
import type { Mailer } from '../mailer.js';
import { createOrganizationInvitation } from './create-organization-invitation.js';

export interface InviteOrganizationOwnerInput {
  organizationId: string;
  organizationName: string;
  email: string;
  inviterId: string;
}

export interface InviteOrganizationOwnerResult {
  invitationId: string;
}

export async function inviteOrganizationOwner(
  pool: Pool,
  mailer: Mailer,
  publicUrl: string,
  input: InviteOrganizationOwnerInput,
): Promise<InviteOrganizationOwnerResult> {
  return createOrganizationInvitation(pool, mailer, publicUrl, {
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    email: input.email,
    role: 'owner',
    inviterId: input.inviterId,
  });
}
