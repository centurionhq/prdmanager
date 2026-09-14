/**
 * `POST /api/app/admin/organizations` (SDD-006 §Autenticación, WO-101, dashboard `/admin` WO-120):
 * superadmin-only, 2FA-verified. Creates an organization and invites its owner by email — the
 * superadmin performing this never gets a membership in it.
 */
import { request } from './request.js';

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
