/**
 * Organization invitations (SDD-006 §Autenticación, WO-105/WO-116): create/list/revoke for org
 * admins+owners (WO-118), and the public accept flow for `/invite/:id` (WO-116).
 */
import type {
  AcceptInvitationInput,
  AccessRequest,
  CreateAccessRequestInput,
  CreateOrganizationInvitationInput,
  InvitationSummary,
} from '@prdm/contracts';
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

/** `POST .../access-requests` (SDD-099 §D2): public, no session; the server answers `{ok: true}` whether or not the org exists. */
export function createAccessRequest(orgSlug: string, input: CreateAccessRequestInput): Promise<{ ok: true }> {
  return request(`/api/app/organizations/${encodeURIComponent(orgSlug)}/access-requests`, { method: 'POST', body: input });
}

/** `GET .../access-requests` (SDD-099 §D4): pending requests, owner/admin only; the shape isn't validated at runtime, hence the guard. */
export function listAccessRequests(orgSlug: string): Promise<AccessRequest[]> {
  return request<{ requests?: AccessRequest[] }>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/access-requests`).then((r) =>
    Array.isArray(r?.requests) ? r.requests : [],
  );
}

export interface AccessRequestDecision {
  requestId: string;
  status: 'approved' | 'rejected';
  invitationId?: string | null;
  alreadyMember?: boolean;
}

/** `POST .../access-requests/:id/approve` (SDD-099 §D4): creates the invitation unless the person is already a member. */
export function approveAccessRequest(orgSlug: string, requestId: string): Promise<AccessRequestDecision> {
  return request(`/api/app/organizations/${encodeURIComponent(orgSlug)}/access-requests/${encodeURIComponent(requestId)}/approve`, {
    method: 'POST',
  });
}

/** `POST .../access-requests/:id/reject` (SDD-099 §D4): the body is sent only when there is a reason. */
export function rejectAccessRequest(orgSlug: string, requestId: string, reason?: string): Promise<AccessRequestDecision> {
  return request(`/api/app/organizations/${encodeURIComponent(orgSlug)}/access-requests/${encodeURIComponent(requestId)}/reject`, {
    method: 'POST',
    body: reason === undefined ? undefined : { reason },
  });
}
