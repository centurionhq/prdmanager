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
