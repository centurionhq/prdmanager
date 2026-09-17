/**
 * `/api/app/profile` (WO-432, closing the gap left open in WO-365/SDD-013's `AjustesPerfil.tsx`
 * comment: "no /api/app/* route exposes it to the dashboard yet"): read and set-once the caller's own
 * `user_profile.handle` -- the "dev:<handle>" actor identity `claim_work_order`/`complete_work_order`/
 * `archive_work_order` require of any human token. Global, not org/project-scoped: `user_profile` is a
 * 1:1 with `user`, not tenant data (unlike every other `/api/app/*` route in this codebase).
 */
import { setUserProfileHandleInputSchema } from '@prdm/contracts';
import { createUserProfile, findUserProfile, HandleTakenError } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';

export interface RegisterProfileRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
}

export function registerProfileRoutes(app: FastifyInstance, opts: RegisterProfileRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get('/api/app/profile', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const profile = await findUserProfile(pool, session.user.id);
    return { handle: profile?.handle ?? null };
  });

  app.post<{ Body: Record<string, unknown> }>('/api/app/profile/handle', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);

    const parsed = setUserProfileHandleInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError('invalid body');

    const existing = await findUserProfile(pool, session.user.id);
    if (existing) throw new ConflictError('handle is already set and cannot be changed');

    try {
      const profile = await createUserProfile(pool, { userId: session.user.id, handle: parsed.data.handle });
      return { handle: profile.handle };
    } catch (err) {
      if (err instanceof HandleTakenError) throw new ConflictError(err.message);
      throw err;
    }
  });
}
