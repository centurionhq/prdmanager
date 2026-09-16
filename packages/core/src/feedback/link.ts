import { z } from 'zod';
import { docId } from '../domain/schema.js';
import type { EngineOps, ProjectEngine } from '../engine.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';

const triageFeedbackSchema = z.object({
  /** Feature ids this feedback should now link to via `informs`, merged with whatever it already has. */
  informs: z.array(docId).optional(),
  /** Same root exemption `createFeatureRequest`'s target validation already respects for Artifact/Feedback. */
  root: z.boolean().optional(),
});

export type TriageFeedbackInput = z.input<typeof triageFeedbackSchema>;

export interface TriageFeedbackResult {
  id: string;
  linkedTo: string[];
  root: boolean;
  /** `'immediate'`: the link is already visible on `published_raw` (a `generated`-origin document, or
   * any local `Engine` document — there is no working-copy concept outside the SaaS `collab` origin).
   * `'deferred'`: the link was queued in `pending_editable_patch` (a `collab`-origin document with a
   * working copy) and only takes effect once that document is next republished. Derived from whether
   * `ops.updateDocument`'s own returned document already reflects the write — `triageFeedback` never
   * needs to know about `origin`/`pending_editable_patch` itself, the same "domain code depends only on
   * EngineOps" boundary every other function in this package already keeps. */
  applied: 'immediate' | 'deferred';
}

async function validateInformsTargets(ops: EngineOps, informs: readonly string[]): Promise<void> {
  const scan = await ops.scan();
  for (const featureId of informs) {
    const target = scan.docs.find((d) => d.node.id === featureId);
    if (!target) throw new Error(`informs target ${featureId} not found`);
    if (target.node.label !== 'Feature') throw new Error(`informs target ${featureId} must be a Feature, got ${target.node.label}`);
  }
}

/**
 * Triages a `new` Feedback document (SDD-012 "Centurion Factory conectado al backend SaaS", WO-330):
 * links it to one or more features (`informs`, merged with whatever it already has) and/or marks it
 * `root: true`, the same target-validation pattern `createFeatureRequest`
 * (`packages/core/src/feedback/ingest.ts`) already uses for a `justified_by`/`feedbackId` link, then sets
 * `status: 'triaged'` (a plain string field, not lifecycle-managed — no schema change needed). At least
 * one of `informs`/`root` is required, mirroring `createFeatureRequest`'s own "requires justified_by" gate.
 */
export async function triageFeedback(engine: ProjectEngine, id: string, input: TriageFeedbackInput): Promise<TriageFeedbackResult> {
  const parsed = triageFeedbackSchema.parse(input);
  const informs = [...new Set(parsed.informs ?? [])];
  if (informs.length === 0 && parsed.root !== true) {
    throw new Error('triage_feedback requires "informs" (one or more feature ids) or "root: true"');
  }

  return engine.transaction(
    async (ops) => {
      const scan = await ops.scan();
      const feedback = scan.docs.find((d) => d.node.id === id);
      if (!feedback) throw new Error(`feedback ${id} not found`);
      if (feedback.node.label !== 'Feedback' || feedback.frontmatter.type !== 'FB') throw new Error(`${id} is not Feedback`);
      if (feedback.frontmatter.status !== 'new') throw new Error(`${id} is "${feedback.frontmatter.status}"; only new feedback can be triaged`);

      await validateInformsTargets(ops, informs);

      const linkedTo = [...new Set([...feedback.frontmatter.informs, ...informs])];
      const fields: Record<string, FieldValue> = { informs: linkedTo, status: 'triaged' };
      if (parsed.root !== undefined) fields.root = parsed.root;

      const updated = await ops.updateDocument(id, fields);
      await ops.refresh();

      const applied: TriageFeedbackResult['applied'] = updated.frontmatter.type === 'FB' && updated.frontmatter.status === 'triaged' ? 'immediate' : 'deferred';
      return { id, linkedTo, root: parsed.root ?? false, applied };
    },
    { atomic: true },
  );
}
