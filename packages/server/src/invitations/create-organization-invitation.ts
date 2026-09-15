/**
 * General invitation creation (SDD-006 §Autenticación, WO-105): inserts the `invitation` row, its
 * one-time secret (`invitation_secrets`) and any project grants, then emails the accept link with the
 * secret only in the URL fragment (`/invite/:id#s=<secret>` — never in the path/query, so it never
 * reaches proxy/CDN access logs, per SDD-006). `../api/admin-organizations.ts`'s owner-invite flow
 * (`./invite-organization-owner.ts`) and `../api/organization-invitations.ts`'s member-invite endpoint
 * both call this; it is the one place that ever emails an invitation link.
 */
import { randomUUID } from 'node:crypto';
import { addProjectInvitationGrants, connect, createInvitationSecret, schema, type ProjectRole } from '@prdm/db';
import type { Pool } from 'pg';
import { escapeHtml, sanitizeNameForHtml, sanitizeNameForText } from '../email/sanitize.js';
import type { Mailer } from '../mailer.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OrganizationInvitationProjectGrant {
  projectId: string;
  role: ProjectRole;
}

export interface CreateOrganizationInvitationInput {
  organizationId: string;
  organizationName: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  inviterId: string;
  grants?: readonly OrganizationInvitationProjectGrant[];
}

export interface CreateOrganizationInvitationResult {
  invitationId: string;
}

export async function createOrganizationInvitation(
  pool: Pool,
  mailer: Mailer,
  publicUrl: string,
  input: CreateOrganizationInvitationInput,
): Promise<CreateOrganizationInvitationResult> {
  const db = connect(pool);
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  await db.insert(schema.invitation).values({
    id,
    organizationId: input.organizationId,
    email: input.email,
    role: input.role,
    status: 'pending',
    expiresAt,
    createdAt: now,
    inviterId: input.inviterId,
  });

  const { secret } = await createInvitationSecret(pool, { invitationId: id, orgId: input.organizationId, expiresAt });

  if (input.grants && input.grants.length > 0) {
    await addProjectInvitationGrants(pool, { invitationId: id, orgId: input.organizationId, grants: input.grants });
  }

  // The secret lives only in the fragment (`#s=`): browsers never send a URL fragment to the server on
  // navigation, and it never reaches proxy/CDN access logs the way a path or query parameter would
  // (SDD-006 §Autenticación). Never logged anywhere in this function either.
  const link = `${publicUrl}/invite/${id}#s=${secret}`;
  const orgNameHtml = sanitizeNameForHtml(input.organizationName);
  const orgNameText = sanitizeNameForText(input.organizationName);

  await mailer.sendMail({
    to: input.email,
    subject: `You've been invited to join "${orgNameText}" on prdm`,
    text: [`You've been invited to join the organization "${orgNameText}" on prdm.`, '', `Accept your invitation: ${link}`].join('\n'),
    html: [
      `<p>You've been invited to join the organization <strong>${orgNameHtml}</strong> on prdm.</p>`,
      `<p><a href="${escapeHtml(link)}">Accept your invitation</a></p>`,
    ].join('\n'),
  });

  return { invitationId: id };
}
