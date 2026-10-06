/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:id/*` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-338): the context an agent/developer needs before picking up a work
 * order, plus claiming and completing it.
 */
import type { ArchiveWorkOrderInput, ClaimWorkOrderInput, CompleteWorkOrderInput, WorkOrderContextDto } from '@prdm/contracts';
import type { ArchiveResult, WorkOrderSummary } from '@prdm/core';
import { request } from './request.js';

function workOrderBase(orgSlug: string, projectSlug: string, workOrderId: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/work-orders/${encodeURIComponent(workOrderId)}`;
}

export function getWorkOrderContext(orgSlug: string, projectSlug: string, workOrderId: string): Promise<WorkOrderContextDto> {
  return request<{ context: WorkOrderContextDto }>(`${workOrderBase(orgSlug, projectSlug, workOrderId)}/context`).then((r) => r.context);
}

/** The body is always empty — the assignee is always the calling agent/developer, decided server-side. */
const EMPTY_CLAIM_INPUT: ClaimWorkOrderInput = {};

export function claimWorkOrder(orgSlug: string, projectSlug: string, workOrderId: string): Promise<WorkOrderSummary> {
  return request<{ workOrder: WorkOrderSummary }>(`${workOrderBase(orgSlug, projectSlug, workOrderId)}/claim`, {
    method: 'POST',
    body: EMPTY_CLAIM_INPUT,
  }).then((r) => r.workOrder);
}

export function completeWorkOrder(
  orgSlug: string,
  projectSlug: string,
  workOrderId: string,
  commitSha: string,
): Promise<WorkOrderSummary> {
  const input: CompleteWorkOrderInput = { commitSha };
  return request<{ workOrder: WorkOrderSummary }>(`${workOrderBase(orgSlug, projectSlug, workOrderId)}/complete`, {
    method: 'POST',
    body: input,
  }).then((r) => r.workOrder);
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
