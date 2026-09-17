/**
 * `/api/app/profile` (WO-432): the caller's own `dev:<handle>` actor identity. Global, not
 * org/project-scoped -- see `packages/server/src/api/profile.ts`.
 */
import type { SetUserProfileHandleInput } from '@prdm/contracts';
import { request } from './request.js';

export function getProfile(): Promise<{ handle: string | null }> {
  return request('/api/app/profile');
}

export function setProfileHandle(input: SetUserProfileHandleInput): Promise<{ handle: string }> {
  return request('/api/app/profile/handle', { method: 'POST', body: input });
}
