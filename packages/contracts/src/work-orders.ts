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

/** `POST .../work-orders/:id/claim`: intentionally empty — the assignee is always the calling
 * agent/developer, decided server-side, never something a client may specify. */
export const claimWorkOrderInputSchema = z.strictObject({});
export type ClaimWorkOrderInput = z.infer<typeof claimWorkOrderInputSchema>;

export const completeWorkOrderInputSchema = z.object({
  commitSha: z.string().regex(SHA_PATTERN),
});
export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderInputSchema>;
