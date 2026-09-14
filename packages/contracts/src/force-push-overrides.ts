/**
 * `POST .../code-reports/force-push-overrides` input (SDD-010 "Modo baseline de code-reports",
 * WO-181): a project admin authorizes exactly one `head_sha` to regress the registered baseline head.
 */
import { z } from 'zod';

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

export const forcePushOverrideInputSchema = z.strictObject({
  headSha: z.string().regex(SHA_PATTERN, 'expected a git commit sha (7-40 hex characters)'),
});
export type ForcePushOverrideInput = z.infer<typeof forcePushOverrideInputSchema>;
