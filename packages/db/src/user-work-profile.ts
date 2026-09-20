/**
 * `user_work_profile` read/upsert access (SDD-051): global, no-RLS table (1:1 with a `user`), safe to
 * read and write through the raw `pool` exactly like `user_profile`.
 */
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { connect } from './pool.js';
import { userWorkProfile, type WORK_PROFILE_VALUES } from './schema/user-work-profile.js';

export type WorkProfileValue = (typeof WORK_PROFILE_VALUES)[number];

/** `null` when the person has not chosen yet -- which is a state the UI renders on purpose (the entry
 * band asks), not a missing value to paper over with a default. */
export async function findUserWorkProfile(pool: Pool, userId: string): Promise<WorkProfileValue | null> {
  const db = connect(pool);
  const rows = await db.select({ profile: userWorkProfile.profile }).from(userWorkProfile).where(eq(userWorkProfile.userId, userId));
  return (rows[0]?.profile as WorkProfileValue | undefined) ?? null;
}

/** Idempotent upsert: choosing the same profile twice, or changing it, are both just a write. */
export async function setUserWorkProfile(pool: Pool, userId: string, profile: WorkProfileValue): Promise<WorkProfileValue> {
  const db = connect(pool);
  await db
    .insert(userWorkProfile)
    .values({ userId, profile })
    .onConflictDoUpdate({ target: userWorkProfile.userId, set: { profile, updatedAt: new Date() } });
  return profile;
}
