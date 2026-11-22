/**
 * Success-metrics DTO (SDD-012, WO-327): mirrors `@prdm/core`'s `SuccessMetrics`
 * (`packages/core/src/metrics/metrics.ts`) field-for-field.
 */
import { z } from 'zod';

export const unmeasuredReasonSchema = z.enum(['missing_claim', 'missing_completion', 'invalid_timestamp', 'negative_duration']);

export const unmeasuredWorkOrderSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  reason: unmeasuredReasonSchema,
  claimedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const unmeasuredSchema = z.object({
  total: z.number().int().min(0),
  workOrders: z.array(unmeasuredWorkOrderSchema),
});

export const slowOrderSchema = z.object({
  id: z.string().min(1),
  claimedAt: z.string(),
  completedAt: z.string(),
  resolutionHours: z.number(),
});

export const slowestSchema = z.object({
  thresholdHours: z.number(),
  total: z.number().int().min(0),
  items: z.array(slowOrderSchema),
});

export const agentHumanEfficiencySchema = z.object({
  completedWorkOrders: z.number().int().min(0),
  measuredWorkOrders: z.number().int().min(0),
  avgResolutionHours: z.number().nullable(),
  medianResolutionHours: z.number().nullable(),
  p90ResolutionHours: z.number().nullable(),
  maxResolutionHours: z.number().nullable(),
  slowest: slowestSchema,
  unmeasured: unmeasuredSchema,
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

export const untracedCommitSchema = z.object({
  sha: z.string().min(1),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
  files: z.array(z.string()),
  gap: z.enum(['no_refs', 'dangling_refs']),
  class: z.enum(['merge', 'bookkeeping', 'code']),
});

export const untracedCommitsSchema = z.object({
  total: z.number().int().min(0),
  danglingRefs: z.number().int().min(0),
  byClass: z.object({
    merge: z.number().int().min(0),
    bookkeeping: z.number().int().min(0),
    code: z.number().int().min(0),
  }),
  truncated: z.boolean(),
  items: z.array(untracedCommitSchema),
});

export const commitsWindowSchema = z.object({
  branch: z.string().nullable(),
  sha: z.string().nullable(),
  reportedAt: z.string().nullable(),
});

export const featureKindSchema = z.enum(['MRD', 'PRD', 'FR', 'BC']);

export const featureKindBreakdownSchema = z.object({
  kind: featureKindSchema,
  total: z.number().int().min(0),
  traced: z.number().int().min(0),
});

export const traceabilitySchema = z.object({
  featuresByKind: z.array(featureKindBreakdownSchema),
  featuresTotal: z.number().int().min(0),
  featuresTraced: z.number().int().min(0),
  orphanFeatures: z.array(orphanFeatureSchema),
  featurePercent: z.number().nullable(),
  commitsTotal: z.number().int().min(0),
  commitsWithRefs: z.number().int().min(0),
  commitsTraced: z.number().int().min(0),
  commitPercent: z.number().nullable(),
  commitsWindow: commitsWindowSchema,
  untracedCommits: untracedCommitsSchema,
});

/**
 * SDD-126 D3 (FR-073): capacidades en ventanas de 7 y 30 días. Sumas que cierran: `sum(createdByKind.total)` =
 * documentos creados en la ventana; `feedback.new + triaged + closed = feedback.created`; y por feature
 * `delivered <= withWorkOrders <= withDesign <= created`.
 */
export const capacityKindSchema = z.enum(['PRD', 'FR', 'SDD', 'ADR', 'WO', 'BC', 'FB']);

export const capacityKindCountSchema = z.object({
  kind: capacityKindSchema,
  total: z.number().int().min(0),
});

export const capacityFeatureLineSchema = z.object({
  kind: z.enum(['PRD', 'FR']),
  created: z.number().int().min(0),
  withDesign: z.number().int().min(0),
  withWorkOrders: z.number().int().min(0),
  delivered: z.number().int().min(0),
});

export const capacityFeedbackSchema = z.object({
  created: z.number().int().min(0),
  new: z.number().int().min(0),
  triaged: z.number().int().min(0),
  closed: z.number().int().min(0),
  pendingClose: z.number().int().min(0),
});

export const capacityWindowSchema = z.object({
  days: z.union([z.literal(7), z.literal(30)]),
  createdByKind: z.array(capacityKindCountSchema),
  features: z.array(capacityFeatureLineSchema),
  feedback: capacityFeedbackSchema,
  passageExceptions: z.number().int().min(0),
});

export const capacitiesSchema = z.object({
  windows: z.array(capacityWindowSchema).length(2),
});
export type CapacitiesDto = z.infer<typeof capacitiesSchema>;

const EMPTY_CAPACITY_WINDOW_BASE = {
  createdByKind: capacityKindSchema.options.map((kind) => ({ kind, total: 0 })),
  features: [
    { kind: 'PRD' as const, created: 0, withDesign: 0, withWorkOrders: 0, delivered: 0 },
    { kind: 'FR' as const, created: 0, withDesign: 0, withWorkOrders: 0, delivered: 0 },
  ],
  feedback: { created: 0, new: 0, triaged: 0, closed: 0, pendingClose: 0 },
  passageExceptions: 0,
};

/** Capacidades en cero (ventanas de 7 y 30 días): fixtures de test y estado vacío. */
export const EMPTY_CAPACITIES: CapacitiesDto = {
  windows: [
    { days: 7, ...EMPTY_CAPACITY_WINDOW_BASE },
    { days: 30, ...EMPTY_CAPACITY_WINDOW_BASE },
  ],
};

export const successMetricsSchema = z.object({
  agentHumanEfficiency: agentHumanEfficiencySchema,
  systemIntegrity: systemIntegritySchema,
  traceability: traceabilitySchema,
  capacities: capacitiesSchema,
});
export type SuccessMetricsDto = z.infer<typeof successMetricsSchema>;
