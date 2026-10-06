/**
 * `/api/app/profile` (WO-432): the caller's own `dev:<handle>` actor identity, and (WO-543, SDD-051) the
 * work profile they picked on the Planta's entry band. Global, not org/project-scoped -- see
 * `packages/server/src/api/profile.ts`.
 */
import type { ProfileResponse, SetUserProfileHandleInput, SetWorkProfileInput, WorkProfile } from '@prdm/contracts';
import { request } from './request.js';

/** One read carries both the handle and the work profile: it is the call the app already makes at boot,
 * so the entry band knows the profile before it renders instead of waiting on a second request. */
export function getProfile(): Promise<ProfileResponse> {
  return request('/api/app/profile');
}

export function setProfileHandle(input: SetUserProfileHandleInput): Promise<{ handle: string }> {
  return request('/api/app/profile/handle', { method: 'POST', body: input });
}

/** Idempotent, and meant to change: unlike the handle, picking a different profile is just another write. */
export function setWorkProfile(input: SetWorkProfileInput): Promise<{ workProfile: WorkProfile }> {
  return request('/api/app/profile/work-profile', { method: 'POST', body: input });
}
