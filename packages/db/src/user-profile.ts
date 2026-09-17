/**
 * `user_profile` read/create access (SDD-006 §Modelo de datos): global, no-RLS table (1:1 with a
 * `user`), safe to read/write through the raw `pool` like any other better-auth-adjacent table.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { connect } from './pool.js';
import { userProfile } from './schema/user-profile.js';

export interface UserProfileRecord {
  userId: string;
  handle: string;
}

export async function findUserProfile(pool: Pool, userId: string): Promise<UserProfileRecord | null> {
  const db = connect(pool);
  const rows = await db.select({ userId: userProfile.userId, handle: userProfile.handle }).from(userProfile).where(eq(userProfile.userId, userId));
  return rows[0] ?? null;
}

/** Postgres 23505 (unique_violation) covers both a handle already in use (the table's own UNIQUE
 * constraint) and one that was ever used before and released (`retired_handles`'s reuse-guard trigger
 * re-raises with the same ERRCODE, see `schema/user-profile.ts`) -- both are "not available", so a
 * single error type covers them. The `user_id` primary-key conflict (calling this for a user who
 * already has a profile) is also 23505, but `registerProfileRoutes` (WO-432) pre-checks `findUserProfile`
 * first, so that race is narrow enough not to warrant its own error type. */
export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`handle "${handle}" is not available`);
    this.name = 'HandleTakenError';
  }
}

/** drizzle-orm wraps the raw `pg` error in its own `DrizzleQueryError`, moving the real Postgres error
 * (with `.code`) to `.cause` -- checked at both levels so this doesn't depend on that wrapping. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as { code?: unknown }).code === '23505') return true;
  const cause = (err as { cause?: unknown }).cause;
  return typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '23505';
}

/** WO-432: the handle is immutable once set (enforced in the database, see `schema/user-profile.ts`'s
 * `forbid_user_profile_handle_update` trigger), so this is create-once -- there is no update function. */
export async function createUserProfile(pool: Pool, input: UserProfileRecord): Promise<UserProfileRecord> {
  const db = connect(pool);
  try {
    const rows = await db.insert(userProfile).values({ userId: input.userId, handle: input.handle }).returning({ userId: userProfile.userId, handle: userProfile.handle });
    return rows[0]!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new HandleTakenError(input.handle);
    throw err;
  }
}
