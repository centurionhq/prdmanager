/**
 * `POST /api/app/admin/organizations` (SDD-006 §Autenticación, WO-101, dashboard `/admin` WO-120):
 * superadmin-only, 2FA-verified. Creates an organization and invites its owner by email — the
 * superadmin performing this never gets a membership in it.
 */
import { request } from './request.js';

/** `GET /api/app/admin/organizations` (WO-120 server addition, flagged in the WO report): id/slug/name
 * only, never membership or project content (SDD-006: superadmins have no implicit access to it). */
export interface AdminOrganizationSummary {
  id: string;
  slug: string;
  name: string;
}

export function listAllOrganizationsAsSuperadmin(): Promise<AdminOrganizationSummary[]> {
  return request<{ organizations: AdminOrganizationSummary[] }>('/api/app/admin/organizations').then((r) => r.organizations);
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  ownerEmail: string;
}

export interface CreateOrganizationResult {
  organizationId: string;
  slug: string;
  invitationId: string;
}

export function createOrganizationAsSuperadmin(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  return request('/api/app/admin/organizations', { method: 'POST', body: input });
}
