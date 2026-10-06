/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:id/*` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-338): the context an agent/developer needs before picking up a work
 * order, plus claiming and completing it.
 */
import type { ArchiveWorkOrderInput, BatchWorkOrdersInput, ClaimWorkOrderInput, CompleteWorkOrderInput, WorkOrderContextDto } from '@prdm/contracts';
import type { ArchiveResult, ClaimResult, CompleteResult } from '@prdm/core';
import { request } from './request.js';

function projectWorkOrdersBase(orgSlug: string, projectSlug: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/work-orders`;
}

function workOrderBase(orgSlug: string, projectSlug: string, workOrderId: string): string {
  return `${projectWorkOrdersBase(orgSlug, projectSlug)}/${encodeURIComponent(workOrderId)}`;
}

export function getWorkOrderContext(orgSlug: string, projectSlug: string, workOrderId: string): Promise<WorkOrderContextDto> {
  return request<{ context: WorkOrderContextDto }>(`${workOrderBase(orgSlug, projectSlug, workOrderId)}/context`).then((r) => r.context);
}

/** Without `assignee` the body is `{}` and the server assigns the caller; with it, the chosen `dev:`/`agent:` actor. */
export function claimWorkOrder(orgSlug: string, projectSlug: string, workOrderId: string, assignee?: string): Promise<ClaimResult> {
  const input: ClaimWorkOrderInput = assignee !== undefined ? { assignee } : {};
  return request<{ result: ClaimResult }>(`${workOrderBase(orgSlug, projectSlug, workOrderId)}/claim`, {
    method: 'POST',
    body: input,
  }).then((r) => r.result);
}

export function completeWorkOrder(
  orgSlug: string,
  projectSlug: string,
  workOrderId: string,
  commitSha: string,
): Promise<CompleteResult> {
  const input: CompleteWorkOrderInput = { commitSha };
  return request<{ result: CompleteResult }>(`${workOrderBase(orgSlug, projectSlug, workOrderId)}/complete`, {
    method: 'POST',
    body: input,
  }).then((r) => r.result);
}

/**
 * Archives a `pending`/`in_progress`/`out_of_sync` work order (SDD-018, exposed by SDD-064 §WO-B /
 * FB-069). `reason` is optional; omitting it posts `{}` so the server's own optional-field default
 * applies. The server answers with its domain result under `{ result }`, so this unwraps that envelope
 * instead of `{ workOrder }` — `archiveWorkOrder` returns the archive metadata, not the summary.
 */
export function archiveWorkOrder(
  orgSlug: string,
  projectSlug: string,
  workOrderId: string,
  reason?: string,
): Promise<ArchiveResult> {
  const input: ArchiveWorkOrderInput = reason !== undefined ? { reason } : {};
  return request<{ result: ArchiveResult }>(`${workOrderBase(orgSlug, projectSlug, workOrderId)}/archive`, {
    method: 'POST',
    body: input,
  }).then((r) => r.result);
}

/** One item's own outcome of the batch: a partial failure is data, never an exception. */
export interface BatchWorkOrderItemResult {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Mirrors the server's own `{ results, archived, claimed }` answer (SDD-086 §D4, hand-synced with
 * `packages/server/src/api/project-work-orders.ts`). Unlike claim/complete/archive, this route answers
 * with the envelope *itself* rather than under `{ result }`.
 */
export interface BatchWorkOrdersResult {
  readonly results: BatchWorkOrderItemResult[];
  readonly archived: number;
  readonly claimed: number;
}

/**
 * `POST .../work-orders/batch` (SDD-086 §D4/D6): archives or claims 1..200 orders best-effort — a failing
 * item comes back as `ok: false` with the server's own message and never aborts the rest.
 */
export function batchWorkOrders(
  orgSlug: string,
  projectSlug: string,
  input: BatchWorkOrdersInput,
): Promise<BatchWorkOrdersResult> {
  return request<BatchWorkOrdersResult>(`${projectWorkOrdersBase(orgSlug, projectSlug)}/batch`, {
    method: 'POST',
    body: input,
  });
}
