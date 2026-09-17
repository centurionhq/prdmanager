/**
 * `POST .../documents/:docId/force-close` input (SDD-018 "Cierre forzado auditado", WO-419): a project
 * admin bypasses one or more of `blueprints_have_work_orders`/`work_orders_done`/`project_clean` with a
 * mandatory `reason` -- hand-synced with `@prdm/core`'s own `ForceCloseBypassableCheck` literal union
 * (`feature_exists`/`feature_approved` are deliberately absent from both: never bypassable).
 */
import { z } from 'zod';

export const FORCE_CLOSE_BYPASSABLE_CHECKS = ['blueprints_have_work_orders', 'work_orders_done', 'project_clean'] as const;
export type ForceCloseBypassableCheckDto = (typeof FORCE_CLOSE_BYPASSABLE_CHECKS)[number];

export const forceCloseFeatureInputSchema = z.object({
  reason: z.string().min(1, 'reason is required to force-close a feature').max(2000),
  bypass: z.array(z.enum(FORCE_CLOSE_BYPASSABLE_CHECKS)).min(1, 'bypass must name at least one check'),
});
export type ForceCloseFeatureInput = z.infer<typeof forceCloseFeatureInputSchema>;
