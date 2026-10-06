/**
 * `POST .../documents/:docId/impacts-paths/sync` input (SDD-021 "Reconciliacion de impacts_paths desde
 * CI", WO-430): the caller must echo back exactly the `suggestedAdditions` the read side
 * (`get_impacts_paths_drift`) just showed them -- the same optimistic-concurrency contract
 * `publish_document`'s `version_id`/`content_hash` pair already uses, so a suggestion that changed
 * underneath the operator (e.g. a new CI report landed) can never be silently applied stale.
 */
import { z } from 'zod';

export const syncImpactsPathsInputSchema = z.object({
  expectedSuggestion: z.array(z.string().min(1)),
  // SDD-072 D3 (WO-642): echo of the `narrowing.suggestedRemovals` patterns the caller wants applied;
  // omitted means "no removals", so a pre-SDD-072 body stays valid.
  expectedRemovals: z.array(z.string().min(1)).default([]),
  // `.trim()` first, same reasoning as `forceCloseFeatureInputSchema`'s own `reason` field: a
  // whitespace-only reason is rejected here (400) rather than passing this schema.
  reason: z.string().trim().min(1, 'reason is required to sync impacts_paths').max(2000),
});
export type SyncImpactsPathsInput = z.infer<typeof syncImpactsPathsInputSchema>;
