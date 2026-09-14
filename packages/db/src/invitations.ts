/**
 * Invitation secrets, project grants and atomic acceptance (SDD-006 §Autenticación / §Modelo de datos,
 * WO-105).
 *
 * The one-time secret is generated and stored as a sha256 hash, distinct from `invitation.id`
 * (SDD-006: "un secreto de un solo uso de 32 bytes distinto del id"), and resolved *before* any
 * `org_id` is known through `resolve_invitation`, a `SECURITY DEFINER` function owned by `prdm_owner`
 * (hand-appended to `packages/db/migrations/0003_invitation_secrets_and_grants.sql`) — the WO-097
 * pattern, matched purely on the secret's hash so an id alone (visible in the accept URL's path) proves
 * nothing.
 *
 * Acceptance (`acceptInvitationAsNewUser`/`acceptInvitationForExistingUser`) runs entirely inside one
 * `withTenantTx`: claiming the secret (`SELECT ... FOR UPDATE` then a guarded `UPDATE`, so concurrent
 * accepts of the *same* invitation serialize on that row lock and only one observes `consumedAt IS
 * NULL`), creating the user/account or reusing the existing one, adding the `member` row, applying
 * every project grant, and marking the `invitation` accepted — one transaction, one commit, matching
 * SDD-006's "acepta atómicamente".
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { account, invitation, member, user } from './schema/auth.js';
import { invitationSecrets, projectInvitationGrants } from './schema/invitations.js';
import { projectMembers } from './schema/projects.js';
import type { ProjectRole } from './repositories.js';
import { connect, type PgDatabase } from './pool.js';
import { withTenantTx } from './tenant.js';

export function hashInvitationSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export interface GeneratedInvitationSecret {
  /** URL-fragment-safe; only this value (never `hash`) is ever emailed or returned to a client. */
  secret: string;
  hash: string;
}

/** 32 random bytes (SDD-006 §Autenticación), base64url-encoded for direct use in a URL fragment. */
export function generateInvitationSecret(): GeneratedInvitationSecret {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: hashInvitationSecret(secret) };
}

export interface CreateInvitationSecretInput {
  invitationId: string;
  orgId: string;
  expiresAt: Date;
}

export async function createInvitationSecret(pool: Pool, input: CreateInvitationSecretInput): Promise<GeneratedInvitationSecret> {
  const generated = generateInvitationSecret();
  await withTenantTx(pool, input.orgId, async (tx) => {
    await tx.insert(invitationSecrets).values({
      invitationId: input.invitationId,
      orgId: input.orgId,
      secretHash: generated.hash,
      expiresAt: input.expiresAt,
    });
  });
  return generated;
}

export interface ResolvedInvitation {
  orgId: string;
  invitationId: string;
  email: string;
  expiresAt: Date;
}

interface ResolveInvitationRow extends Record<string, unknown> {
  org_id: string;
  invitation_id: string;
  email: string;
  expires_at: string;
}

/** The only lookup path before `org_id` is known (see module doc comment); returns `null` for no
 * match — including a syntactically valid but wrong secret — never distinguishing the two, so this
 * alone can't be used to probe for a valid invitation id. */
export async function resolveInvitationBySecret(pool: Pool, secret: string): Promise<ResolvedInvitation | null> {
  const hash = hashInvitationSecret(secret);
  const db = connect(pool);
  const result = await db.execute<ResolveInvitationRow>(sql`SELECT * FROM resolve_invitation(${hash})`);
  const row = result.rows[0];
  if (!row) return null;
  return { orgId: row.org_id, invitationId: row.invitation_id, email: row.email, expiresAt: new Date(row.expires_at) };
}

export interface ProjectInvitationGrantInput {
  projectId: string;
  role: ProjectRole;
}

export interface AddProjectInvitationGrantsInput {
  invitationId: string;
  orgId: string;
  grants: readonly ProjectInvitationGrantInput[];
}

export async function addProjectInvitationGrants(pool: Pool, input: AddProjectInvitationGrantsInput): Promise<void> {
  if (input.grants.length === 0) return;
  await withTenantTx(pool, input.orgId, async (tx) => {
    await tx
      .insert(projectInvitationGrants)
      .values(input.grants.map((grant) => ({ invitationId: input.invitationId, orgId: input.orgId, projectId: grant.projectId, role: grant.role })));
  });
}

export async function listProjectInvitationGrants(pool: Pool, orgId: string, invitationId: string): Promise<ProjectInvitationGrantInput[]> {
  return withTenantTx(pool, orgId, (tx) =>
    tx
      .select({ projectId: projectInvitationGrants.projectId, role: projectInvitationGrants.role })
      .from(projectInvitationGrants)
      .where(eq(projectInvitationGrants.invitationId, invitationId)),
  );
}

export class InvitationNotFoundError extends Error {
  constructor() {
    super('invitation secret not found');
    this.name = 'InvitationNotFoundError';
  }
}

export class InvitationExpiredError extends Error {
  constructor() {
    super('invitation has expired');
    this.name = 'InvitationExpiredError';
  }
}

export class InvitationAlreadyAcceptedError extends Error {
  constructor() {
    super('invitation has already been accepted or revoked');
    this.name = 'InvitationAlreadyAcceptedError';
  }
}

/** Locks the invitation's secret row, checks it hasn't already been consumed or expired, and consumes
 * it — all inside the caller's own transaction, so a concurrent call for the *same* `invitationId`
 * blocks on the row lock until this one commits or rolls back, then itself observes `consumedAt` set
 * and throws `InvitationAlreadyAcceptedError` (the "exactly one accept wins" race, SDD-006 §Modelo de
 * datos). `now` is injected so tests never depend on real elapsed time to exercise expiry. */
async function claimInvitationSecret(tx: PgDatabase, invitationId: string, now: Date): Promise<void> {
  const rows = await tx
    .select({ consumedAt: invitationSecrets.consumedAt, expiresAt: invitationSecrets.expiresAt })
    .from(invitationSecrets)
    .where(eq(invitationSecrets.invitationId, invitationId))
    .for('update');
  const row = rows[0];
  if (!row) throw new InvitationNotFoundError();
  if (row.consumedAt) throw new InvitationAlreadyAcceptedError();
  if (row.expiresAt.getTime() < now.getTime()) throw new InvitationExpiredError();

  await tx.update(invitationSecrets).set({ consumedAt: now }).where(eq(invitationSecrets.invitationId, invitationId));
}

async function applyProjectGrants(tx: PgDatabase, orgId: string, userId: string, grants: readonly ProjectInvitationGrantInput[]): Promise<void> {
  for (const grant of grants) {
    await tx
      .insert(projectMembers)
      .values({ projectId: grant.projectId, orgId, userId, role: grant.role })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: grant.role } });
  }
}

async function markInvitationAccepted(tx: PgDatabase, invitationId: string): Promise<void> {
  await tx.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, invitationId));
}

export interface AcceptInvitationAsNewUserInput {
  orgId: string;
  invitationId: string;
  /** Always the invitation's own email (resolved server-side) — never client-editable (SDD-006). */
  email: string;
  name: string;
  password: string;
  orgRole: 'owner' | 'admin' | 'member';
  grants: readonly ProjectInvitationGrantInput[];
  now?: Date;
}

export interface AcceptInvitationResult {
  userId: string;
}

/** New-user acceptance path (SDD-006 §Autenticación): creates the user with the invitation's own email
 * and `emailVerified: true`, sets the password, and accepts membership + grants — atomically, in the
 * same transaction that consumes the secret. The account row's shape (`providerId: 'credential'`,
 * `accountId` = the new user's id, `password` = `hashPassword(...)` from `better-auth/crypto`) mirrors
 * exactly what `/sign-up/email` itself writes, so the resulting user can sign in normally afterward. */
export async function acceptInvitationAsNewUser(pool: Pool, input: AcceptInvitationAsNewUserInput): Promise<AcceptInvitationResult> {
  const now = input.now ?? new Date();
  return withTenantTx(pool, input.orgId, async (tx) => {
    await claimInvitationSecret(tx, input.invitationId, now);

    const passwordHash = await hashPassword(input.password);
    const userId = `user_${randomUUID()}`;
    await tx.insert(user).values({ id: userId, name: input.name, email: input.email, emailVerified: true, createdAt: now, updatedAt: now });
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(member).values({ id: randomUUID(), organizationId: input.orgId, userId, role: input.orgRole, createdAt: now });
    await applyProjectGrants(tx, input.orgId, userId, input.grants);
    await markInvitationAccepted(tx, input.invitationId);

    return { userId };
  });
}

export interface AcceptInvitationForExistingUserInput {
  orgId: string;
  invitationId: string;
  userId: string;
  orgRole: 'owner' | 'admin' | 'member';
  grants: readonly ProjectInvitationGrantInput[];
  now?: Date;
}

/** Existing-user acceptance path (SDD-006 §Autenticación: "exige sesión con ese email más el secreto")
 * — the caller (the HTTP route) has already verified the signed-in session's email matches the
 * invitation before calling this; this function only ever adds membership/grants for `userId`. */
export async function acceptInvitationForExistingUser(pool: Pool, input: AcceptInvitationForExistingUserInput): Promise<AcceptInvitationResult> {
  const now = input.now ?? new Date();
  return withTenantTx(pool, input.orgId, async (tx) => {
    await claimInvitationSecret(tx, input.invitationId, now);

    await tx
      .insert(member)
      .values({ id: randomUUID(), organizationId: input.orgId, userId: input.userId, role: input.orgRole, createdAt: now })
      .onConflictDoNothing();
    await applyProjectGrants(tx, input.orgId, input.userId, input.grants);
    await markInvitationAccepted(tx, input.invitationId);

    return { userId: input.userId };
  });
}

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
}

/** `invitation` is global (no RLS — it's a better-auth table), so this is safe to call before any
 * `org_id`/tenant context is established, same as `resolveInvitationBySecret`. Used by the accept
 * endpoint once it already has the invitation id (from `resolveInvitationBySecret`) to read the
 * organization role the invitation grants — deliberately not part of `resolve_invitation`'s own return
 * shape (SDD-006 names exactly `org_id`, `invitation_id`, `email`, `expires_at` for that function). */
export async function findInvitationById(pool: Pool, invitationId: string): Promise<InvitationRecord | null> {
  const db = connect(pool);
  const rows = await db
    .select({ id: invitation.id, organizationId: invitation.organizationId, email: invitation.email, role: invitation.role, status: invitation.status })
    .from(invitation)
    .where(eq(invitation.id, invitationId));
  return rows[0] ?? null;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
}

/** Never selects `invitation_secrets` at all (SDD-006: "Ningún listado devuelve secretos") — there is
 * no code path here that could leak one even by accident. */
export async function listOrganizationInvitations(pool: Pool, orgId: string): Promise<InvitationSummary[]> {
  const db = connect(pool);
  return db
    .select({ id: invitation.id, email: invitation.email, role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(eq(invitation.organizationId, orgId));
}

export interface RevokeInvitationInput {
  orgId: string;
  invitationId: string;
  now?: Date;
}

/** Admin revocation (SDD-006 §Autenticación): consumes the secret without accepting anything, so any
 * later accept attempt (even with the correct secret) hits `InvitationAlreadyAcceptedError`. A no-op
 * (not an error) if the invitation was already consumed or doesn't have a secret row — revoking twice
 * is harmless. */
export async function revokeInvitation(pool: Pool, input: RevokeInvitationInput): Promise<void> {
  const now = input.now ?? new Date();
  await withTenantTx(pool, input.orgId, async (tx) => {
    await tx
      .update(invitationSecrets)
      .set({ consumedAt: now })
      .where(and(eq(invitationSecrets.invitationId, input.invitationId), sql`${invitationSecrets.consumedAt} IS NULL`));
    await tx.update(invitation).set({ status: 'canceled' }).where(eq(invitation.id, input.invitationId));
  });
}
