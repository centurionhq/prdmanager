import { z } from 'zod';

export const DOC_KINDS = ['MRD', 'PRD', 'FR', 'SDD', 'ADR', 'WO', 'ART', 'FB'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const NODE_LABELS = ['Feature', 'Blueprint', 'WorkOrder', 'Artifact', 'Feedback'] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

export const LABEL_BY_KIND: Readonly<Record<DocKind, NodeLabel>> = {
  MRD: 'Feature',
  PRD: 'Feature',
  FR: 'Feature',
  SDD: 'Blueprint',
  ADR: 'Blueprint',
  WO: 'WorkOrder',
  ART: 'Artifact',
  FB: 'Feedback',
};

export const DOC_REL_TYPES = ['EVOLVES_FROM', 'ARCHITECTS', 'IMPLEMENTS', 'PROVIDES_CONTEXT_FOR', 'INFORMS'] as const;
export type DocRelType = (typeof DOC_REL_TYPES)[number];

export const WORK_ORDER_STATUSES = ['todo', 'in_progress', 'done', 'out_of_sync'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const ID_PATTERN = /^(MRD|PRD|FR|SDD|ADR|WO|ART|FB)-\d{3,}$/;
export const ACTOR_PATTERN = /^(agent|dev):[A-Za-z0-9._-]{1,64}$/;
export const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

export const docId = z.string().regex(ID_PATTERN, 'invalid document id (expected e.g. PRD-001)');
const idList = z.array(docId).default([]);
const isoLike = z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v));
const optionalTimestamp = z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString() : v)).optional();

const base = z.object({
  id: docId,
  title: z.string().min(1).max(300),
  status: z.string().max(40).optional(),
  created_at: isoLike.optional(),
  tags: z.array(z.string().max(60)).default([]),
});

export const featureSchema = base.extend({
  type: z.enum(['MRD', 'PRD', 'FR']),
  implements: idList,
  evolves_from: idList,
});

export const blueprintSchema = base.extend({
  type: z.enum(['SDD', 'ADR']),
  architects: z.array(docId).min(1, 'a blueprint must architect at least one feature'),
  governs: z.array(z.string().min(1).max(300)).default([]),
});

export const workOrderSchema = base.extend({
  type: z.literal('WO'),
  status: z.enum(WORK_ORDER_STATUSES).default('todo'),
  implements: z.array(docId).min(1, 'a work order must implement at least one blueprint'),
  assigned_to: z.string().regex(ACTOR_PATTERN, 'assigned_to must look like agent:name or dev:name').optional(),
  claimed_at: optionalTimestamp,
  completed_at: optionalTimestamp,
  resolved_by: z.array(z.string().regex(SHA_PATTERN)).default([]),
  governs: z.array(z.string().min(1).max(300)).default([]),
  source_task: z.string().max(64).optional(),
  blueprint_hashes: z.record(docId, z.string().regex(/^[0-9a-f]{64}$/)).default({}),
});

export const artifactSchema = base.extend({
  type: z.literal('ART'),
  source: z.enum(['meeting', 'email', 'slack', 'call', 'doc', 'other']).default('other'),
  provides_context_for: idList,
});

export const feedbackSchema = base.extend({
  type: z.literal('FB'),
  source: z.string().min(1).max(60).default('other'),
  customer: z.string().max(120).optional(),
  informs: idList,
});

export const frontmatterSchema = z.discriminatedUnion('type', [
  featureSchema,
  blueprintSchema,
  workOrderSchema,
  artifactSchema,
  feedbackSchema,
]);
export type Frontmatter = z.infer<typeof frontmatterSchema>;

export type PropValue = string | number | boolean | string[] | null;

export interface GraphNode {
  id: string;
  label: NodeLabel;
  kind: DocKind;
  title: string;
  body: string;
  status: string;
  tags: string[];
  sourcePath: string;
  createdAt: string | null;
  contentHash: string;
  props: Record<string, PropValue>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: DocRelType;
}

export interface Actor {
  id: string;
  kind: 'ai_agent' | 'developer';
}

export interface ParsedDoc {
  node: GraphNode;
  edges: GraphEdge[];
  governs: string[];
  actor: Actor | null;
  frontmatter: Frontmatter;
}

export function kindOfId(id: string): DocKind | null {
  const prefix = id.split('-')[0];
  return (DOC_KINDS as readonly string[]).includes(prefix ?? '') ? (prefix as DocKind) : null;
}

export const DEFAULT_STATUS: Readonly<Record<NodeLabel, string>> = {
  Feature: 'draft',
  Blueprint: 'active',
  WorkOrder: 'todo',
  Artifact: 'active',
  Feedback: 'new',
};
