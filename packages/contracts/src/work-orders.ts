/**
 * Work-order context and claim/complete payload DTOs (SDD-012 "Centurion Factory conectado al backend
 * SaaS", WO-327): `workOrderContextDtoSchema` mirrors `@prdm/core`'s `getWorkOrderContext` result
 * (`packages/core/src/workorders/context.ts`), hand-synced the same way every other contract already
 * mirrors a `@prdm/core` shape without depending on the package itself.
 */
import { z } from 'zod';

const NODE_LABELS = ['Feature', 'Blueprint', 'WorkOrder', 'Artifact', 'Feedback'] as const;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

const contextNodeSchema = z.object({
  id: z.string(),
  label: z.enum(NODE_LABELS),
  title: z.string(),
  body: z.string(),
});

const workOrderCodeRefSchema = z.object({
  key: z.string(),
  path: z.string(),
  symbol: z.string().nullable(),
  status: z.string(),
  reason: z.string(),
  blueprint: z.string(),
});

const workOrderCommitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
});

export const workOrderContextDtoSchema = z.object({
  workOrder: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    assignedTo: z.string().nullable(),
    sourcePath: z.string(),
    mirrorPath: z.string(),
    body: z.string(),
    acceptanceCriteria: z.array(z.string()),
  }),
  blueprints: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), impactsPaths: z.array(z.string()), body: z.string() })),
  featureLineage: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string(), status: z.string(), body: z.string() })),
  context: z.array(contextNodeSchema),
  code: z.array(workOrderCodeRefSchema),
  commits: z.array(workOrderCommitSchema),
  drift: z.array(workOrderCodeRefSchema),
  instructions: z.string(),
});
export type WorkOrderContextDto = z.infer<typeof workOrderContextDtoSchema>;

/** Hand-synced with `@prdm/core`'s `ACTOR_PATTERN` (`packages/core/src/domain/schema.ts:78`). */
export const ACTOR_PATTERN = /^(agent|dev):[A-Za-z0-9._-]{1,64}$/;

/** `POST .../work-orders/:id/claim` (SDD-086 D1): without `assignee` the server keeps assigning
 * `dev:<profile.handle>`; with it only `agent:<name>` or the caller's own `dev:<handle>` is admitted
 * (the authorization lives in the route, not here). */
export const claimWorkOrderInputSchema = z.object({
  assignee: z.string().regex(ACTOR_PATTERN, 'assignee must look like agent:name or dev:name').optional(),
});
export type ClaimWorkOrderInput = z.infer<typeof claimWorkOrderInputSchema>;

export const completeWorkOrderInputSchema = z.object({
  commitSha: z.string().regex(SHA_PATTERN),
});
export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderInputSchema>;

/** `POST .../work-orders/:id/archive` (SDD-018, WO-415): `reason` is optional, matching
 * `@prdm/core`'s `archiveWorkOrder` own `ArchiveOptions.reason`. */
export const archiveWorkOrderInputSchema = z.object({
  reason: z.string().min(1, 'reason must not be empty when given').max(2000).optional(),
});
export type ArchiveWorkOrderInput = z.infer<typeof archiveWorkOrderInputSchema>;

export const BATCH_WORK_ORDER_ACTIONS = ['archive', 'claim'] as const;
export type BatchWorkOrderAction = (typeof BATCH_WORK_ORDER_ACTIONS)[number];

/** `POST .../work-orders/batch` (SDD-086 D4): best-effort por ítem; tope 200 ids (misma convención que el `triage-batch` de SDD-065 D5). */
export const batchWorkOrdersInputSchema = z.object({
  action: z.enum(BATCH_WORK_ORDER_ACTIONS),
  ids: z.array(z.string().min(1)).min(1).max(200),
  reason: z.string().min(1, 'reason must not be empty when given').max(2000).optional(),
  assignee: z.string().regex(ACTOR_PATTERN, 'assignee must look like agent:name or dev:name').optional(),
});
export type BatchWorkOrdersInput = z.infer<typeof batchWorkOrdersInputSchema>;
