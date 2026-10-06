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

/** WO-445 (SDD-024/PRD-011 §4.4): a PRD nested under its BC's row (`@prdm/core`'s `deriveLineBoard`
 * row-collapsing, WO-443) -- self-referential, so the schema needs the explicit `z.ZodType` annotation +
 * `z.lazy()` zod's recursive-type pattern requires. Always `[]` for a row that isn't a BC. */
export interface FeatureLineDto {
  id: string;
  kind: 'MRD' | 'PRD' | 'FR' | 'BC';
  title: string;
  status: string;
  station: Station;
  andonStation?: Station;
  progress: FeatureLineProgress;
  children: FeatureLineDto[];
}

export const featureLineSchema: z.ZodType<FeatureLineDto> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(['MRD', 'PRD', 'FR', 'BC']),
    title: z.string(),
    status: z.string(),
    station: stationSchema,
    andonStation: stationSchema.optional(),
    progress: featureLineProgressSchema,
    children: z.array(featureLineSchema),
  }),
);

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
  memberCount: z.number().int().min(0).optional(),
  lastActivityAt: z.string().nullable(),
});
export type ProjectOverviewDto = z.infer<typeof projectOverviewSchema>;
