import { docId, NODE_LABELS, WORK_ORDER_STATUSES, type NodeLabel } from '@prdm/core';
import { z, type ZodType } from 'zod';
import { ValidationError } from './errors.js';

/** `params`/`query` are always plain objects of strings from Fastify; `zod.safeParse` never throws on its own. */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'invalid request';
    throw new ValidationError(message);
  }
  return result.data;
}

/** `/api/node/:id`, `/api/branch/:id`, `/api/work-orders/:id` (SDD-005 "Contrato HTTP"). */
export const idParamsSchema = z.object({ id: docId });

/** CSV of `NODE_LABELS`; an unknown label is a 400, never silently dropped (SDD-005 "esquemas zod"). */
const labelsQuerySchema = z
  .string()
  .optional()
  .transform((value, ctx): NodeLabel[] | undefined => {
    if (value === undefined) return undefined;
    const labels = value
      .split(',')
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
    for (const label of labels) {
      if (!(NODE_LABELS as readonly string[]).includes(label)) {
        ctx.addIssue({ code: 'custom', message: `unknown label: ${label}` });
        return z.NEVER;
      }
    }
    return labels as NodeLabel[];
  });

/** `/api/search`: `q` 1..200 chars, `labels?` csv of `NODE_LABELS`, `limit` 1..100 default 10. */
export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  labels: labelsQuerySchema,
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** `/api/tree`: optional `root`, same id shape as every other document reference. */
export const treeQuerySchema = z.object({ root: docId.optional() });
export type TreeQuery = z.infer<typeof treeQuerySchema>;

/** `/api/work-orders`: both filters optional, `status` restricted to `WORK_ORDER_STATUSES`. */
export const workOrdersQuerySchema = z.object({
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  blueprint: docId.optional(),
});
export type WorkOrdersQuery = z.infer<typeof workOrdersQuerySchema>;
