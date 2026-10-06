/**
 * Access requests (SDD-099 §D1): create, list pending, resolve. `access_request` has RLS enabled+forced,
 * so every function runs inside `withTenantTx`. The record never exposes `orgId` — the server already
 * knows which organization it is talking about.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { accessRequest } from './schema/access-requests.js';
import { withTenantTx } from './tenant.js';

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccessRequestRecord {
  id: string;
  email: string;
  name: string | null;
  message: string | null;
  status: AccessRequestStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

const recordColumns = {
  id: accessRequest.id,
  email: accessRequest.email,
  name: accessRequest.name,
  message: accessRequest.message,
  status: accessRequest.status,
  createdAt: accessRequest.createdAt,
  resolvedAt: accessRequest.resolvedAt,
  resolvedBy: accessRequest.resolvedBy,
};

export interface CreateAccessRequestInput {
  orgId: string;
  email: string;
  name?: string | null;
  message?: string | null;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** `email` → trim + lower-case; `name`/`message` → trimmed, with `''`/`null`/`undefined` stored as `null`. */
export async function createAccessRequest(pool: Pool, input: CreateAccessRequestInput): Promise<AccessRequestRecord> {
  return withTenantTx(pool, input.orgId, async (tx) => {
    const rows = await tx
      .insert(accessRequest)
      .values({
        orgId: input.orgId,
        email: input.email.trim().toLowerCase(),
        name: trimToNull(input.name),
        message: trimToNull(input.message),
      })
      .returning(recordColumns);
    return rows[0]!;
  });
}

/** Only `status = 'pending'`, oldest first (FIFO). */
export async function listPendingAccessRequests(pool: Pool, orgId: string): Promise<AccessRequestRecord[]> {
  return withTenantTx(pool, orgId, (tx) =>
    tx
      .select(recordColumns)
      .from(accessRequest)
      .where(eq(accessRequest.status, 'pending'))
      .orderBy(asc(accessRequest.createdAt), asc(accessRequest.id)),
  );
}

export class AccessRequestNotFoundError extends Error {
  constructor() {
    super('access request not found');
    this.name = 'AccessRequestNotFoundError';
  }
}

export class AccessRequestAlreadyResolvedError extends Error {
  constructor() {
    super('access request has already been resolved');
    this.name = 'AccessRequestAlreadyResolvedError';
  }
}

export interface ResolveAccessRequestInput {
  orgId: string;
  id: string;
  status: 'approved' | 'rejected';
  resolvedBy: string;
}

/** Locks the row (`FOR UPDATE`) so two concurrent resolutions serialize and only one sees `pending`. RLS
 * hides another organization's row, so it surfaces as `AccessRequestNotFoundError`. */
export async function resolveAccessRequest(pool: Pool, input: ResolveAccessRequestInput): Promise<AccessRequestRecord> {
  return withTenantTx(pool, input.orgId, async (tx) => {
    const current = await tx.select({ status: accessRequest.status }).from(accessRequest).where(eq(accessRequest.id, input.id)).for('update');
    if (!current[0]) throw new AccessRequestNotFoundError();
    if (current[0].status !== 'pending') throw new AccessRequestAlreadyResolvedError();

    const rows = await tx
      .update(accessRequest)
      .set({ status: input.status, resolvedAt: new Date(), resolvedBy: input.resolvedBy })
      .where(and(eq(accessRequest.id, input.id), eq(accessRequest.status, 'pending')))
      .returning(recordColumns);
    return rows[0]!;
  });
}
