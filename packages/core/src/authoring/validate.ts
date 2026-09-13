import type { ParsedDoc } from '../domain/schema.js';
import { checkLifecycle } from '../lifecycle/check.js';
import { EXPECTED_TARGET } from '../sync/monitor.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';
import { renderDocument } from '../util/ids.js';
import { parseDocument } from '../parser/frontmatter.js';
import type { ScanResult } from '../parser/scan.js';
import type { GrandfatheredDoc } from '../project/types.js';
import { forbiddenFieldIssues } from './forbidden-fields.js';
import type { DraftRecord } from './draft-store.js';
import type { DraftKind, ValidationIssue } from './types.js';

const RELATION_FIELDS = ['implements', 'evolves_from', 'architects', 'provides_context_for', 'informs', 'justified_by'] as const;
/** A reference to another still-open draft: either its opaque draft id, or the `KIND-?` placeholder shown for a create draft. */
const DRAFT_REF_PATTERN = /^(drf_[A-Za-z0-9_-]+|[A-Z]+-\?)$/;

export const SYNTHETIC_ID_SUFFIX = '000000000';
/** A real-looking (but never persisted or exposed) id used only so the draft's body can be run through the normal parser/link checks before it has a real id. */
export function syntheticId(kind: DraftKind): string {
  return `${kind}-${SYNTHETIC_ID_SUFFIX}`;
}

interface ExtractedFields {
  clean: Record<string, FieldValue>;
  draftRefs: { field: string; ref: string }[];
}

/** Pulls references to other uncommitted drafts out of relation fields so they don't fail schema validation as bogus ids; each becomes a blocking `draft_dependency` issue instead. */
function extractDraftRefs(fields: Record<string, FieldValue> | undefined): ExtractedFields {
  const clean: Record<string, FieldValue> = { ...fields };
  const draftRefs: { field: string; ref: string }[] = [];
  for (const key of RELATION_FIELDS) {
    const value = fields?.[key];
    if (!Array.isArray(value)) continue;
    const kept: string[] = [];
    for (const entry of value) {
      if (typeof entry === 'string' && DRAFT_REF_PATTERN.test(entry)) draftRefs.push({ field: key, ref: entry });
      else kept.push(entry);
    }
    clean[key] = kept;
  }
  return { clean, draftRefs };
}

function buildFrontmatterFields(record: DraftRecord, internalId: string, cleanOverrides: Record<string, FieldValue>): Record<string, FieldValue> {
  const base = record.mode === 'update' && record.baseFrontmatter ? (record.baseFrontmatter as unknown as Record<string, FieldValue>) : {};
  return { ...base, ...cleanOverrides, id: internalId, type: record.kind, title: record.content.title };
}

export interface ValidationOutcome {
  issues: ValidationIssue[];
  /** The draft rendered for display: a create draft's id is shown as `KIND-?`, never the internal synthetic id. */
  rendered: string;
  targetPath: string | null;
  /** Frontmatter fields with draft-only references stripped, ready to persist once the draft has a real id. */
  cleanFields: Record<string, FieldValue>;
  internalId: string;
}

export interface ValidationContext {
  scan: ScanResult;
  grandfathered: readonly GrandfatheredDoc[];
}

/**
 * Pure (no store I/O) validation of a draft: forbidden fields, schema, link targets, dependencies on other
 * uncommitted drafts, lifecycle invariants and (for an update draft) staleness against the file on disk.
 */
export function validateDraft(record: DraftRecord, ctx: ValidationContext): ValidationOutcome {
  const issues: ValidationIssue[] = [...forbiddenFieldIssues(record.content.fields)];
  const { clean, draftRefs } = extractDraftRefs(record.content.fields);
  for (const ref of draftRefs) {
    issues.push({ severity: 'error', code: 'draft_dependency', field: ref.field, message: `${ref.field} depends on uncommitted draft ${ref.ref}; commit it first` });
  }

  const internalId = record.mode === 'create' ? syntheticId(record.kind) : record.targetId;
  const fields = buildFrontmatterFields(record, internalId, clean);
  const displayFields = record.mode === 'create' ? { ...fields, id: `${record.kind}-?` } : fields;
  const rendered = renderDocument(displayFields, record.content.body);
  const targetPath = record.mode === 'update' ? (record.basePath ?? null) : null;

  const sourcePathForParse = record.basePath ?? `__draft__/${internalId}.md`;
  const internalContent = renderDocument(fields, record.content.body);
  const parsed = parseDocument(internalContent, sourcePathForParse);
  if (!parsed) {
    issues.push({ severity: 'error', code: 'schema', message: 'draft content has no valid id/type frontmatter' });
    return { issues, rendered, targetPath, cleanFields: fields, internalId };
  }
  if (!parsed.ok) {
    issues.push({ severity: 'error', code: 'schema', message: parsed.error });
    return { issues, rendered, targetPath, cleanFields: fields, internalId };
  }

  if (record.mode === 'update') {
    const current = ctx.scan.docs.find((d) => d.node.id === record.targetId);
    if (!current) {
      issues.push({ severity: 'error', code: 'stale_base', message: `${record.targetId} no longer exists on disk` });
    } else if (current.node.contentHash !== record.baseHash) {
      issues.push({ severity: 'error', code: 'stale_base', message: `${record.targetId} changed on disk since this draft was opened; discard and re-open it` });
    }
  }

  const others = ctx.scan.docs.filter((d) => d.node.id !== internalId && d.node.id !== record.targetId);
  const overlaid: ParsedDoc[] = [...others, parsed.doc];
  const byId = new Map(overlaid.map((d) => [d.node.id, d]));
  for (const edge of parsed.doc.edges) {
    const target = byId.get(edge.to);
    if (!target) {
      issues.push({ severity: 'error', code: 'broken_link', field: edge.type, message: `${edge.type} links to missing ${edge.to}` });
      continue;
    }
    if (!EXPECTED_TARGET[edge.type].includes(target.node.label)) {
      issues.push({ severity: 'error', code: 'invalid_link_target', field: edge.type, message: `${edge.type} must target a ${EXPECTED_TARGET[edge.type].join(' or ')}, got ${target.node.label} (${edge.to})` });
    }
  }

  const lifecycleIssues = checkLifecycle(overlaid, { grandfathered: ctx.grandfathered });
  for (const issue of lifecycleIssues) {
    if (issue.nodeId !== internalId && issue.nodeId !== record.targetId) continue;
    issues.push({ severity: issue.severity, code: 'lifecycle', message: issue.message.replaceAll(internalId, record.targetId) });
  }

  return { issues, rendered, targetPath, cleanFields: fields, internalId };
}
