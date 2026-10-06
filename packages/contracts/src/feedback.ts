/**
 * Feedback-inbox DTOs (SDD-012, WO-327): `inboxItemSchema` is a Feedback or Artifact document shown to
 * a triager, `submitFeedbackInputSchema` mirrors `@prdm/core`'s `submitFeedback` input
 * (`packages/core/src/feedback/ingest.ts`) and `candidateSchema` mirrors `triageText`'s scored
 * suggestions.
 */
import { z } from 'zod';

/** Hand-duplicated from `governance.ts` (and `@prdm/core`'s doc-id pattern); contracts never import core. */
const DOC_ID = z.string().regex(/^(MRD|PRD|FR|BC|SDD|ADR|WO|ART|FB)-\d{3,9}$/, 'invalid document id (expected e.g. PRD-001)');

/** Documentary only (SDD-065 D5/D7): `inboxItemSchema.status` stays a free string. */
export const FEEDBACK_STATUSES = ['new', 'triaged', 'closed', 'dismissed', 'duplicate'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** SDD-092: cap on the free-form references (`WO-xxx`, `PR #nn`, a sha) a closed Feedback can record. */
export const MAX_CLOSE_RESOLVED_BY = 20;

export const MAX_INBOX_LIMIT = 200;
export const DEFAULT_INBOX_LIMIT = 25;
export const MAX_TRIAGE_BATCH_IDS = 200;

export const inboxItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['FB', 'ART']),
  title: z.string(),
  body: z.string(),
  status: z.string(),
  source: z.string(),
  links: z.array(z.string()),
  receivedAt: z.string(),
  /** Optional on purpose: existing `InboxItemDto` literals (app tests) keep compiling. */
  duplicateOf: z.string().nullable().optional(),
});
export type InboxItemDto = z.infer<typeof inboxItemSchema>;

export const inboxResponseSchema = z.object({
  items: z.array(inboxItemSchema),
  total: z.number().int().nonnegative(),
});
export type InboxResponseDto = z.infer<typeof inboxResponseSchema>;

export const inboxQuerySchema = z.object({
  status: z.string().max(40).optional(),
  kind: z.enum(['FB', 'ART']).optional(),
  source: z.string().max(60).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_INBOX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type InboxQueryDto = z.infer<typeof inboxQuerySchema>;

export const dismissFeedbackInputSchema = z.object({ reason: z.string().max(2000).optional() });
export type DismissFeedbackInputDto = z.infer<typeof dismissFeedbackInputSchema>;

export const closeFeedbackInputSchema = z.object({
  reason: z.string().max(2000).optional(),
  resolvedBy: z.array(z.string().min(1).max(300)).max(MAX_CLOSE_RESOLVED_BY).optional(),
});
export type CloseFeedbackInputDto = z.infer<typeof closeFeedbackInputSchema>;

export const markDuplicateInputSchema = z.object({ duplicateOf: DOC_ID });
export type MarkDuplicateInputDto = z.infer<typeof markDuplicateInputSchema>;

export const triageBatchInputSchema = z
  .object({
    action: z.enum(['dismiss', 'duplicate']),
    ids: z.array(DOC_ID).min(1).max(MAX_TRIAGE_BATCH_IDS),
    reason: z.string().max(2000).optional(),
    duplicateOf: DOC_ID.optional(),
  })
  .refine((value) => value.action !== 'duplicate' || value.duplicateOf !== undefined, {
    message: 'action "duplicate" requires "duplicateOf"',
    path: ['duplicateOf'],
  });
export type TriageBatchInputDto = z.infer<typeof triageBatchInputSchema>;

export const dismissFeedbackResultSchema = z.object({
  id: z.string(),
  status: z.literal('dismissed'),
  reason: z.string().nullable(),
  applied: z.enum(['immediate', 'deferred']),
});
export type DismissFeedbackResultDto = z.infer<typeof dismissFeedbackResultSchema>;

export const markDuplicateResultSchema = z.object({
  id: z.string(),
  status: z.literal('duplicate'),
  duplicateOf: z.string(),
  applied: z.enum(['immediate', 'deferred']),
});
export type MarkDuplicateResultDto = z.infer<typeof markDuplicateResultSchema>;

export const triageBatchItemResultSchema = z.object({ id: z.string(), ok: z.boolean(), error: z.string().optional() });
export type TriageBatchItemResultDto = z.infer<typeof triageBatchItemResultSchema>;

export const triageBatchResultSchema = z.object({
  action: z.enum(['dismiss', 'duplicate']),
  results: z.array(triageBatchItemResultSchema),
  ok: z.number().int(),
  failed: z.number().int(),
});
export type TriageBatchResultDto = z.infer<typeof triageBatchResultSchema>;

export const submitFeedbackInputSchema = z.object({
  text: z.string().min(1).max(20_000),
  source: z.string().min(1).max(60),
  title: z.string().min(1).max(300).optional(),
  customer: z.string().max(120).optional(),
});
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackInputSchema>;

/** Same reason vocabulary as `@prdm/core`'s `TriageReason` (hand-synced). */
export const candidateSchema = z.object({
  featureId: z.string(),
  score: z.number(),
  reason: z.enum(['mention', 'score', 'none']),
});
export type CandidateDto = z.infer<typeof candidateSchema>;
