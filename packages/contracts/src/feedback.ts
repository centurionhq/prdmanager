/**
 * Feedback-inbox DTOs (SDD-012, WO-327): `inboxItemSchema` is a Feedback or Artifact document shown to
 * a triager, `submitFeedbackInputSchema` mirrors `@prdm/core`'s `submitFeedback` input
 * (`packages/core/src/feedback/ingest.ts`) and `candidateSchema` mirrors `triageText`'s scored
 * suggestions.
 */
import { z } from 'zod';

export const inboxItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['FB', 'ART']),
  title: z.string(),
  body: z.string(),
  status: z.string(),
  source: z.string(),
  links: z.array(z.string()),
  receivedAt: z.string(),
});
export type InboxItemDto = z.infer<typeof inboxItemSchema>;

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
