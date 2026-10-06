import { z } from 'zod';

/**
 * `BC` (Caso de Negocio, PRD-011/SDD-022): reuses the `Feature` label rather than a new graph label --
 * see `businessCaseSchema`'s own doc comment for why. Its own `justified_by` produces the same
 * `JUSTIFIED_BY` edge every other Feature already gets, chaining `FB`/`ART` -> `BC` -> `PRD`.
 */
export const DOC_KINDS = ['MRD', 'PRD', 'FR', 'BC', 'SDD', 'ADR', 'WO', 'ART', 'FB'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const NODE_LABELS = ['Feature', 'Blueprint', 'WorkOrder', 'Artifact', 'Feedback'] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

export const LABEL_BY_KIND: Readonly<Record<DocKind, NodeLabel>> = {
  MRD: 'Feature',
  PRD: 'Feature',
  FR: 'Feature',
  BC: 'Feature',
  SDD: 'Blueprint',
  ADR: 'Blueprint',
  WO: 'WorkOrder',
  ART: 'Artifact',
  FB: 'Feedback',
};

export const DOC_REL_TYPES = ['EVOLVES_FROM', 'ARCHITECTS', 'IMPLEMENTS', 'PROVIDES_CONTEXT_FOR', 'INFORMS', 'JUSTIFIED_BY'] as const;
export type DocRelType = (typeof DOC_REL_TYPES)[number];

export const ARTIFACT_SOURCES = ['meeting', 'email', 'slack', 'call', 'doc', 'other'] as const;
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];

export const WORK_ORDER_STATUSES = ['pending', 'in_progress', 'done', 'out_of_sync', 'archived'] as const;
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

export const ID_PATTERN = /^(MRD|PRD|FR|BC|SDD|ADR|WO|ART|FB)-\d{3,9}$/;
export const ACTOR_PATTERN = /^(agent|dev):[A-Za-z0-9._-]{1,64}$/;
export const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
/** No control characters or newlines (prompt-fence breakout guard, MCP prompts embed titles verbatim). */
export const TITLE_PATTERN = /^[^\x00-\x1f\x7f]+$/;

export const docId = z.string().regex(ID_PATTERN, 'invalid document id (expected e.g. PRD-001)');
const idList = z.array(docId).default([]);
const isoLike = z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v));
const optionalTimestamp = z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString() : v)).optional();

const base = z.object({
  id: docId,
  title: z.string().min(1).max(300).regex(TITLE_PATTERN, 'title must not contain control characters or newlines'),
  status: z.string().max(40).optional(),
  created_at: isoLike.optional(),
  tags: z.array(z.string().max(60)).default([]),
});

/**
 * PRD-002 §3 lifecycle fields, added without defaults so their absence never changes an existing document's
 * content hash (`contentHash` omits keys whose value is `undefined`): `justified_by` stays part of the hashed
 * frontmatter (it is authoring intent, not a runtime-derived field) while `closed_at`/`closed_by` are volatile
 * (see `VOLATILE_FIELDS` in `parser/frontmatter.ts`) because they are written by `prdm close`, not an author.
 */
export const featureSchema = base.extend({
  type: z.enum(['MRD', 'PRD', 'FR']),
  implements: idList,
  evolves_from: idList,
  justified_by: z.array(docId).optional(),
  closed_at: optionalTimestamp,
  closed_by: z.string().regex(ACTOR_PATTERN, 'closed_by must look like agent:name or dev:name').optional(),
  /**
   * SDD-018 "Cierre forzado auditado": same hash-neutral pattern as `closed_at`/`closed_by` above --
   * added without defaults so their absence never changes an existing document's content hash. Written
   * by `forceCloseFeature`, never by an author (see `FORBIDDEN_STATIC_FIELDS`).
   */
  close_reason: z.string().max(2000).optional(),
  closed_forced: z.boolean().optional(),
});

/**
 * `BC` (Caso de Negocio, PRD-011 §4.1/SDD-022): reuses the `Feature` label (`LABEL_BY_KIND.BC`) rather
 * than a new `NodeLabel` -- a label change would touch `docs/model/graph-model.json`, the Neo4j
 * constraints, `search_nodes`'s label filter and every by-label render, for no benefit the chain
 * `FB`/`ART` -> `BC` -> `PRD` doesn't already get from the existing `justified_by`/`JUSTIFIED_BY` edge.
 * Its own schema (not a `featureSchema` variant) because a BC's required content lives in its body's
 * four sections (`checkBusinessCase`, SDD-023), never in `implements`/`evolves_from` -- fields a BC has
 * no use for and that `checkFeature`'s justification rule doesn't apply to.
 *
 * `closed_at`/`closed_by`/`close_reason`/`closed_forced` mirror `featureSchema`'s own hash-neutral
 * fields exactly: reusing the `Feature` label makes a BC eligible for `closeFeature`/`forceCloseFeature`
 * (both gate on `node.label === 'Feature'`, not on `DocKind`), so it needs the same fields those write.
 */
export const businessCaseSchema = base.extend({
  type: z.literal('BC'),
  justified_by: z.array(docId).optional(),
  closed_at: optionalTimestamp,
  closed_by: z.string().regex(ACTOR_PATTERN, 'closed_by must look like agent:name or dev:name').optional(),
  close_reason: z.string().max(2000).optional(),
  closed_forced: z.boolean().optional(),
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
  /**
   * SDD-018 "Archivado de Work Orders": same hash-neutral pattern as `featureSchema`'s `closed_at`/
   * `closed_by` above — added without defaults so their absence never changes an existing document's
   * content hash. Written by `archiveWorkOrder`, never by an author (see `FORBIDDEN_STATIC_FIELDS`).
   */
  archived_at: optionalTimestamp,
  archived_by: z.string().regex(ACTOR_PATTERN, 'archived_by must look like agent:name or dev:name').optional(),
  archive_reason: z.string().max(2000).optional(),
});

export const artifactSchema = base.extend({
  type: z.literal('ART'),
  source: z.enum(ARTIFACT_SOURCES).default('other'),
  provides_context_for: idList,
  /** Ingestion-time exemption from the "must link a Feature" lifecycle rule (SDD-002 "Ciclo de vida"); optional, no default. */
  root: z.boolean().optional(),
});

export const feedbackSchema = base.extend({
  type: z.literal('FB'),
  source: z.string().min(1).max(60).default('other'),
  customer: z.string().max(120).optional(),
  informs: idList,
  /** Same root exemption as Artifact; Feature documents (MRD/PRD/FR) deliberately have no such exemption. */
  root: z.boolean().optional(),
  /** SDD-065 D5: FB id this feedback duplicates. Optional, no default (hash-neutral for existing docs). */
  duplicate_of: docId.optional(),
  /** SDD-065 D5: free-form reason recorded when a feedback is dismissed. Optional, no default. */
  dismiss_reason: z.string().max(2000).optional(),
});

export const frontmatterSchema = z.preprocess(
  normalizeFrontmatterAliases,
  z.discriminatedUnion('type', [featureSchema, businessCaseSchema, blueprintSchema, workOrderSchema, artifactSchema, feedbackSchema]),
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
