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

export const ARTIFACT_SOURCES = ['meeting', 'email', 'slack', 'call', 'doc', 'other'] as const;
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];

export const WORK_ORDER_STATUSES = ['pending', 'in_progress', 'done', 'out_of_sync'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** ADR-002 D9/legacy alias support: `governs` -> `impacts_paths`, WO `status: todo` -> `pending`. */
export interface FrontmatterDeprecation {
  field: string;
  replacement: string;
}

function isAliasableKind(type: unknown): type is 'SDD' | 'ADR' | 'WO' {
  return type === 'SDD' || type === 'ADR' || type === 'WO';
}

/** Raw frontmatter (pre-validation) setting both the legacy and canonical field for the same concept. */
export function frontmatterAliasConflict(raw: Record<string, unknown>): string | null {
  if (isAliasableKind(raw.type) && 'governs' in raw && 'impacts_paths' in raw) {
    return `${String(raw.id ?? raw.type)}: cannot set both "governs" (deprecated) and "impacts_paths"; remove "governs"`;
  }
  return null;
}

/** Deprecated fields present in raw frontmatter, computed before alias normalization. */
export function frontmatterDeprecations(raw: Record<string, unknown>): FrontmatterDeprecation[] {
  const deprecations: FrontmatterDeprecation[] = [];
  if (isAliasableKind(raw.type) && 'governs' in raw && !('impacts_paths' in raw)) {
    deprecations.push({ field: 'governs', replacement: 'impacts_paths' });
  }
  if (raw.type === 'WO' && raw.status === 'todo') {
    deprecations.push({ field: 'status: todo', replacement: 'status: pending' });
  }
  return deprecations;
}

/** zod preprocess: rewrites legacy aliases to their canonical field/value before validation. */
function normalizeFrontmatterAliases(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const data: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (isAliasableKind(data.type) && 'governs' in data && !('impacts_paths' in data)) {
    data.impacts_paths = data.governs;
    delete data.governs;
  }
  if (data.type === 'WO' && data.status === 'todo') data.status = 'pending';
  return data;
}

export const ID_PATTERN = /^(MRD|PRD|FR|SDD|ADR|WO|ART|FB)-\d{3,9}$/;
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
  impacts_paths: z.array(z.string().min(1).max(300)).default([]),
});

export const workOrderSchema = base.extend({
  type: z.literal('WO'),
  status: z.enum(WORK_ORDER_STATUSES).default('pending'),
  implements: z.array(docId).min(1, 'a work order must implement at least one blueprint'),
  assigned_to: z.string().regex(ACTOR_PATTERN, 'assigned_to must look like agent:name or dev:name').optional(),
  claimed_at: optionalTimestamp,
  completed_at: optionalTimestamp,
  resolved_by: z.array(z.string().regex(SHA_PATTERN)).default([]),
  impacts_paths: z.array(z.string().min(1).max(300)).default([]),
  source_task: z.string().max(64).optional(),
  blueprint_hashes: z.record(docId, z.string().regex(/^[0-9a-f]{64}$/)).default({}),
});

export const artifactSchema = base.extend({
  type: z.literal('ART'),
  source: z.enum(ARTIFACT_SOURCES).default('other'),
  provides_context_for: idList,
});

export const feedbackSchema = base.extend({
  type: z.literal('FB'),
  source: z.string().min(1).max(60).default('other'),
  customer: z.string().max(120).optional(),
  informs: idList,
});

export const frontmatterSchema = z.preprocess(
  normalizeFrontmatterAliases,
  z.discriminatedUnion('type', [featureSchema, blueprintSchema, workOrderSchema, artifactSchema, feedbackSchema]),
);
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
  impactsPaths: string[];
  actor: Actor | null;
  frontmatter: Frontmatter;
  deprecations: FrontmatterDeprecation[];
}

export function kindOfId(id: string): DocKind | null {
  const prefix = id.split('-')[0];
  return (DOC_KINDS as readonly string[]).includes(prefix ?? '') ? (prefix as DocKind) : null;
}

export const DEFAULT_STATUS: Readonly<Record<NodeLabel, string>> = {
  Feature: 'draft',
  Blueprint: 'active',
  WorkOrder: 'pending',
  Artifact: 'active',
  Feedback: 'new',
};
