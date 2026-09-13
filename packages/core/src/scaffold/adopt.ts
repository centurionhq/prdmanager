import { z } from 'zod';

/** Independent, minimal reader for the legacy `prdm.config.json` (PRD-001): `prdm init --adopt` only ever reads it. */
const legacyConfigSchema = z.object({
  docsDir: z.string().min(1).default('docs'),
  ignore: z.array(z.string().min(1)).default([]),
  gitMaxCommits: z.number().int().positive().max(100_000).default(500),
  triage: z
    .object({
      autoLinkMinScore: z.number().positive().default(0.5),
      autoLinkMargin: z.number().min(1).default(1.05),
      maxCandidates: z.number().int().min(1).max(50).default(5),
      minMatchedTerms: z.number().int().min(0).default(2),
    })
    .prefault({}),
});

export type LegacyConfig = z.infer<typeof legacyConfigSchema>;

/** Parses `prdm.config.json` contents for `--adopt`; throws with a message prefixed for CLI display on any failure. */
export function parseLegacyConfig(src: string): LegacyConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch (err) {
    throw new Error(`prdm.config.json is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = legacyConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`prdm.config.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}
