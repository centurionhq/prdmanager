/**
 * `user_profile` read access (SDD-006 §Modelo de datos): global, no-RLS table (1:1 with a `user`), safe
 * to read through the raw `pool` like any other better-auth-adjacent table.
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
