/**
 * Organization invitations (SDD-006 §Autenticación, WO-105/WO-116): create/list/revoke for org
 * admins+owners (WO-118), and the public accept flow for `/invite/:id` (WO-116).
 */
import type { AcceptInvitationInput, CreateOrganizationInvitationInput, InvitationSummary } from '@prdm/contracts';
import { request } from './request.js';

export function listOrganizationInvitations(orgSlug: string): Promise<InvitationSummary[]> {
  return request<{ invitations: InvitationSummary[] }>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/invitations`).then(
    (r) => r.invitations,
  );
}

export function createOrganizationInvitation(orgSlug: string, input: CreateOrganizationInvitationInput): Promise<{ invitationId: string }> {
  return request(`/api/app/organizations/${encodeURIComponent(orgSlug)}/invitations`, { method: 'POST', body: input });
}

export function revokeOrganizationInvitation(orgSlug: string, invitationId: string): Promise<void> {
  return request(`/api/app/organizations/${encodeURIComponent(orgSlug)}/invitations/${encodeURIComponent(invitationId)}/revoke`, {
    method: 'POST',
  }).then(() => undefined);
}

/** `POST .../invitations/:id/resend` (SDD-012, WO-343): re-sends the same still-pending invitation
 * (a fresh email, not a new secret/expiry) — admin/owner only, gated server-side. */
export function resendInvitation(orgSlug: string, invitationId: string): Promise<void> {
  return request(`/api/app/organizations/${encodeURIComponent(orgSlug)}/invitations/${encodeURIComponent(invitationId)}/resend`, {
    method: 'POST',
  }).then(() => undefined);
}

export interface AcceptInvitationResult {
  userId: string;
  organizationId: string;
}

/** `id` is the path segment from `/invite/:id`; `input.secret` is the fragment (`#s=...`) the SPA reads
 * client-side and never lets reach a server access log (SDD-006 §Autenticación). */
export function acceptInvitation(id: string, input: AcceptInvitationInput): Promise<AcceptInvitationResult> {
  return request(`/api/app/invitations/${encodeURIComponent(id)}/accept`, { method: 'POST', body: input });
}
