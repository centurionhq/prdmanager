/**
 * `POST /api/app/profile/handle` input (WO-432, closing the gap left open in WO-365/SDD-013): sets the
 * caller's own `user_profile.handle` -- the "dev:<handle>" actor identity `claim_work_order`/
 * `complete_work_order`/`archive_work_order` require -- exactly once. Kept in sync by hand with
 * `@prdm/db`'s `HANDLE_PATTERN` (`schema/user-profile.ts`) and `@prdm/core`'s `ACTOR_PATTERN`.
 */
import { z } from 'zod';

export const HANDLE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const setUserProfileHandleInputSchema = z.object({
  handle: z.string().regex(HANDLE_PATTERN, 'handle must be 1-64 characters of letters, digits, ".", "_" or "-"'),
});
export type SetUserProfileHandleInput = z.infer<typeof setUserProfileHandleInputSchema>;

/**
 * `POST /api/app/profile/work-profile` input and the `workProfile` half of `GET /api/app/profile`
 * (SDD-051/PRD-033 R1): which way of working the caller picked on the Planta's entry band -- negocio,
 * producto or developer. Kept in sync by hand with `@prdm/db`'s `WORK_PROFILE_VALUES`
 * (`schema/user-work-profile.ts`) and that table's CHECK constraint.
 *
 * It is a routing preference, not a permission: nothing authorizes off it, and it never appears in
 * `can(subject, ...)`. PRD-033 is explicit that the profile "no introduce roles, RBAC ni cambia la
 * autorización existente".
 */
export const WORK_PROFILES = ['negocio', 'producto', 'developer'] as const;
export type WorkProfile = (typeof WORK_PROFILES)[number];
export const workProfileSchema = z.enum(WORK_PROFILES);

export const setWorkProfileInputSchema = z.object({ workProfile: workProfileSchema });
export type SetWorkProfileInput = z.infer<typeof setWorkProfileInputSchema>;

/** `workProfile: null` means "has not chosen yet" -- a state the entry band renders on purpose (it asks),
 * so there is no default to guess and nothing that could flash the wrong one. */
export const profileResponseSchema = z.object({
  handle: z.string().nullable(),
  workProfile: workProfileSchema.nullable(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
