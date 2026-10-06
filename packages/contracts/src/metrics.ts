/**
 * Success-metrics DTO (SDD-012, WO-327): mirrors `@prdm/core`'s `SuccessMetrics`
 * (`packages/core/src/metrics/metrics.ts`) field-for-field.
 */
import { z } from 'zod';

export const agentHumanEfficiencySchema = z.object({
  completedWorkOrders: z.number().int().min(0),
  measuredWorkOrders: z.number().int().min(0),
  avgResolutionHours: z.number().nullable(),
  medianResolutionHours: z.number().nullable(),
});

export const systemIntegritySchema = z.object({
  governedTotal: z.number().int().min(0),
  governedSynced: z.number().int().min(0),
  syncedPercent: z.number().nullable(),
});

export const orphanFeatureSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  status: z.string(),
});

export const traceabilitySchema = z.object({
  featuresTotal: z.number().int().min(0),
  featuresTraced: z.number().int().min(0),
  orphanFeatures: z.array(orphanFeatureSchema),
  featurePercent: z.number().nullable(),
  commitsTotal: z.number().int().min(0),
  commitsWithRefs: z.number().int().min(0),
  commitsTraced: z.number().int().min(0),
  commitPercent: z.number().nullable(),
});

export const successMetricsSchema = z.object({
  agentHumanEfficiency: agentHumanEfficiencySchema,
  systemIntegrity: systemIntegritySchema,
  traceability: traceabilitySchema,
});
export type SuccessMetricsDto = z.infer<typeof successMetricsSchema>;
