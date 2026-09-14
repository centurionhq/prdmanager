/**
 * Creates the invitation for a newly-created organization's owner (SDD-006 §Autenticación, WO-101).
 *
 * WO-101 lands the organization-creation half of the "superadmin creates an org by inviting its owner"
 * flow; the invitation's one-time secret, its `/invite/:id#s=<secret>` fragment link and the acceptance
 * endpoint are WO-105's job. This function is the single seam WO-105 extends — its signature and every
 * call site (`../api/admin-organizations.ts`) stay the same; only the body (secret generation, the
 * `invitation_secrets` row, and the link it emails) grows.
 */
import { randomUUID } from 'node:crypto';
import { schema, connect } from '@prdm/db';
import type { Pool } from 'pg';
import type { Mailer } from '../mailer.js';
import { escapeHtml, sanitizeNameForHtml, sanitizeNameForText } from '../email/sanitize.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  const db = connect(pool);
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  await db.insert(schema.invitation).values({
    id,
    organizationId: input.organizationId,
    email: input.email,
    role: 'owner',
    status: 'pending',
    expiresAt,
    createdAt: now,
    inviterId: input.inviterId,
  });

  // WO-105 replaces this placeholder link with `${publicUrl}/invite/${id}#s=<secret>` once
  // `invitation_secrets` exists; the fragment never reaches this function's own logs either way.
  const link = `${publicUrl}/invite/${id}`;
  const orgNameHtml = sanitizeNameForHtml(input.organizationName);
  const orgNameText = sanitizeNameForText(input.organizationName);

  await mailer.sendMail({
    to: input.email,
    subject: `You've been invited to own "${orgNameText}" on prdm`,
    text: [`You've been invited to own the organization "${orgNameText}" on prdm.`, '', `Accept your invitation: ${link}`].join('\n'),
    html: [
      `<p>You've been invited to own the organization <strong>${orgNameHtml}</strong> on prdm.</p>`,
      `<p><a href="${escapeHtml(link)}">Accept your invitation</a></p>`,
    ].join('\n'),
  });

  return { invitationId: id };
}
