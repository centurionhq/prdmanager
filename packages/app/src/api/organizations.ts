/**
 * `/api/app/organizations/*` (SDD-006 §Modelo de datos / §Permisos, WO-104): org list, switching the
 * session's active organization, and org membership management (WO-116/WO-117/WO-118).
 */
import type { OrganizationMember, OrganizationSummary, OrgRole } from '@prdm/contracts';
import { request } from './request.js';

export function listOrganizations(): Promise<OrganizationSummary[]> {
  return request<{ organizations: OrganizationSummary[] }>('/api/app/organizations').then((r) => r.organizations);
}

export function setActiveOrganization(organizationId: string): Promise<void> {
  return request('/api/app/organizations/active', { method: 'POST', body: { organizationId } }).then(() => undefined);
}

export function listOrganizationMembers(orgSlug: string): Promise<OrganizationMember[]> {
  return request<{ members: OrganizationMember[] }>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/members`).then((r) => r.members);
}

export function updateOrganizationMemberRole(orgSlug: string, userId: string, role: OrgRole): Promise<void> {
  return request(`/api/app/organizations/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: { role },
  }).then(() => undefined);
}

export function removeOrganizationMember(orgSlug: string, userId: string): Promise<void> {
  return request(`/api/app/organizations/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }).then(
    () => undefined,
  );
}
