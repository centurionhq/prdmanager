/**
 * Feature-line lifecycle DTOs (originally SDD-012 "Centurion Factory conectado al backend SaaS", WO-325;
 * renamed and expanded to seven stations by SDD-024/PRD-011 §4.3, WO-442): the pipeline `@prdm/core`'s
 * `deriveLineBoard` (WO-328) computes and `packages/app`'s Centurion Factory board renders. `Station` is
 * hand-synced with `@prdm/core`'s own station order (same "packages/contracts has no dependency on
 * @prdm/core" convention as `documents.ts`'s `DOCUMENT_KINDS`).
 */
import { z } from 'zod';
import { projectSummarySchema } from './projects.js';

export const STATIONS = ['entrada', 'caso_negocio', 'producto', 'diseno_tecnico', 'planificacion', 'construccion', 'entregado'] as const;
export type Station = (typeof STATIONS)[number];

export const stationSchema = z.enum(STATIONS);

export const featureLineProgressSchema = z.object({
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  stopped: z.number().int().min(0),
});
export type FeatureLineProgress = z.infer<typeof featureLineProgressSchema>;

export const featureLineSchema = z.object({
  id: z.string(),
  kind: z.enum(['MRD', 'PRD', 'FR', 'BC']),
  title: z.string(),
  status: z.string(),
  station: stationSchema,
  andonStation: stationSchema.optional(),
  progress: featureLineProgressSchema,
});
export type FeatureLineDto = z.infer<typeof featureLineSchema>;

export const lineBoardSchema = z.object({
  features: z.array(featureLineSchema),
  andon: z.object({ featureId: z.string(), station: stationSchema }).nullable(),
});
export type LineBoardDto = z.infer<typeof lineBoardSchema>;

export const projectOverviewSchema = projectSummarySchema.extend({
  docCount: z.number().int().min(0),
  furthestStation: stationSchema,
  andonStation: stationSchema.nullable(),
  driftErrors: z.number().int().min(0),
  driftWarnings: z.number().int().min(0),
  awaitingFirstReport: z.boolean(),
  workOrdersInProgress: z.number().int().min(0),
  myRole: z.string(),
  lastActivityAt: z.string().nullable(),
});
export type ProjectOverviewDto = z.infer<typeof projectOverviewSchema>;
