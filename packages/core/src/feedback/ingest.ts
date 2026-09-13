import { z } from 'zod';
import { docId } from '../domain/schema.js';
import type { Engine } from '../engine.js';
import type { SearchHit } from '../graph/types.js';
import { nextId, renderDocument, slugify, todayIso } from '../util/ids.js';
import { proposalTitle, triageText, type TriageProposal, type TriageReason } from './triage.js';

const submitFeedbackSchema = z.object({
  text: z.string().min(1).max(20_000),
  source: z.string().min(1).max(60),
  customer: z.string().max(120).optional(),
  title: z.string().min(1).max(300).optional(),
  now: z.date().optional(),
});

export type SubmitFeedbackInput = z.input<typeof submitFeedbackSchema>;

export interface SubmitFeedbackResult {
  id: string;
  path: string;
  linkedTo: string[];
  reason: TriageReason;
  candidates: SearchHit[];
  proposal: TriageProposal | null;
}

export async function submitFeedback(engine: Engine, input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  const parsed = submitFeedbackSchema.parse(input);

  return engine.transaction(async (ops) => {
    const scan = await ops.scan();
    const triage = await triageText(ops.store, ops.config, parsed.text);

    const id = nextId('FB', scan.ids);
    const title = parsed.title ?? (proposalTitle(parsed.text) || id);
    const slug = slugify(title);
    const fields = {
      id,
      type: 'FB',
      title,
      status: 'new',
      created_at: todayIso(parsed.now),
      source: parsed.source,
      customer: parsed.customer,
      informs: triage.autoLinkTo,
    };
    const content = renderDocument(fields, `## Feedback\n\n${parsed.text}`);
    const doc = await ops.createDocument(`${ops.config.folders.FB}/${id}-${slug}.md`, content);
    await ops.refresh();

    return { id, path: doc.node.sourcePath, linkedTo: triage.autoLinkTo, reason: triage.reason, candidates: triage.candidates, proposal: triage.proposal };
  });
}

const createFeatureRequestSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(20_000),
  parentId: docId,
  /** Feedback/Artifact ids justifying this FR (PRD-002 §3: MRD/PRD/FR require at least one). */
  justifiedBy: z.array(docId).optional(),
  /** Legacy alias: equivalent to `justifiedBy: [feedbackId]` and, additionally, links the feedback back via `informs`. */
  feedbackId: docId.optional(),
  now: z.date().optional(),
});

export type CreateFeatureRequestInput = z.input<typeof createFeatureRequestSchema>;

export interface CreateFeatureRequestResult {
  id: string;
  path: string;
  parentId: string;
  feedbackId: string | null;
  justifiedBy: string[];
}

export async function createFeatureRequest(engine: Engine, input: CreateFeatureRequestInput): Promise<CreateFeatureRequestResult> {
  const parsed = createFeatureRequestSchema.parse(input);

  return engine.transaction(async (ops) => {
    const scan = await ops.scan();
    const parent = scan.docs.find((d) => d.node.id === parsed.parentId);
    if (!parent) throw new Error(`parent ${parsed.parentId} not found`);
    if (parent.node.label !== 'Feature') throw new Error(`parent ${parsed.parentId} is not a Feature`);

    const feedback = parsed.feedbackId ? scan.docs.find((d) => d.node.id === parsed.feedbackId) : undefined;
    if (parsed.feedbackId) {
      if (!feedback) throw new Error(`feedback ${parsed.feedbackId} not found`);
      if (feedback.node.label !== 'Feedback') throw new Error(`${parsed.feedbackId} is not Feedback`);
    }

    const justifiedBy = [...new Set(parsed.justifiedBy ?? (parsed.feedbackId ? [parsed.feedbackId] : []))];
    if (justifiedBy.length === 0) throw new Error('create_feature_request requires "justified_by" (or the legacy "feedback_id")');
    for (const id of justifiedBy) {
      if (id === parsed.feedbackId) continue; // already validated above
      const target = scan.docs.find((d) => d.node.id === id);
      if (!target) throw new Error(`justified_by target ${id} not found`);
      if (target.node.label !== 'Feedback' && target.node.label !== 'Artifact') throw new Error(`justified_by target ${id} must be Feedback or Artifact`);
    }

    const id = nextId('FR', scan.ids);
    const slug = slugify(parsed.title);
    const body = feedback ? `## Descripción\n\n${parsed.description}\n\n## Origen\n\n- ${parsed.feedbackId}` : `## Descripción\n\n${parsed.description}`;
    const fields = {
      id,
      type: 'FR',
      title: parsed.title,
      status: 'proposed',
      created_at: todayIso(parsed.now),
      evolves_from: [parsed.parentId],
      justified_by: justifiedBy,
    };
    const content = renderDocument(fields, body);
    const doc = await ops.createDocument(`${ops.config.folders.FR}/${id}-${slug}.md`, content);

    if (feedback && parsed.feedbackId) {
      const existing = feedback.frontmatter.type === 'FB' ? feedback.frontmatter.informs : [];
      await ops.updateDocument(parsed.feedbackId, { informs: [...new Set([...existing, id])] });
    }

    await ops.refresh();
    return { id, path: doc.node.sourcePath, parentId: parsed.parentId, feedbackId: parsed.feedbackId ?? null, justifiedBy };
  });
}
