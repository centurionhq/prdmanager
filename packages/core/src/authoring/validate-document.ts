import type { ParsedDoc } from '../domain/schema.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';
import { parseDocument } from '../parser/frontmatter.js';
import type { ScanResult } from '../parser/scan.js';
import type { GrandfatheredDoc } from '../project/types.js';
import { EXPECTED_TARGET } from '../sync/monitor.js';
import { renderDocument } from '../util/ids.js';
import { dedupeForbiddenFieldIssues, newLifecycleIssues, type ValidationOutcome } from './validate.js';
import { forbiddenFieldInjectionIssues, forbiddenFieldIssues } from './forbidden-fields.js';
import type { DraftKind, ValidationIssue } from './types.js';

export type ValidateDocumentMode = 'edit' | 'publish';

export interface ValidateDocumentInput {
  kind: DraftKind;
  title: string;
  fields?: Record<string, FieldValue>;
  body: string;
  /** Real, already-assigned id (never a synthetic/draft placeholder — WO-128, unlike `validateDraft`'s create mode). */
  id: string;
  mode: ValidateDocumentMode;
  /** Sha256 of the raw content this edit/publish started from, captured when the editor opened it; compared against `currentRawHash` the same way `validateDraft`'s update mode does (undefined skips the check, e.g. the very first edit of a working copy). */
  baseHash?: string;
  /** Sha256 of the document's raw bytes as they are right now; undefined when they could not be read. */
  currentRawHash?: string;
}

export interface ValidateDocumentContext {
  scan: ScanResult;
  grandfathered: readonly GrandfatheredDoc[];
}

/**
 * Pure (no store I/O) validation for a document that already has a real id (WO-128/SDD-007): the `edit`/`publish`
 * counterpart of `validateDraft` for the SaaS document flow (draft -> in_review -> published -> archived). Shares
 * schema/forbidden-field/lifecycle checks with `validateDraft` via `validate.ts`'s exported helpers rather than
 * duplicating them. The one behavioral difference from `validateDraft` (besides never using a synthetic id): a
 * `broken_link`/`invalid_link_target` issue is only a warning in `edit` mode (the target may simply not be
 * published yet — `PgProjectEngine.scan()` only surfaces published documents, SDD-007) but blocks in `publish`
 * mode, where every link must resolve against what will actually ship.
 */
export function validateDocument(input: ValidateDocumentInput, ctx: ValidateDocumentContext): ValidationOutcome {
  const issues: ValidationIssue[] = [...forbiddenFieldIssues(input.fields)];
  const cleanFields: Record<string, FieldValue> = { ...input.fields, id: input.id, type: input.kind, title: input.title };

  // A real-id document already exists the moment it's created (id_counters assigns it up front, SDD-007), but
  // `scan.docs` may only carry fully parsed PUBLISHED content (PgProjectEngine.scan(): "published_raw" +
  // `scan().ids` for every doc_id in any state) — so an as-yet-unpublished draft is a real, existing document
  // whose full content just isn't in `docs`. Existence is checked against `ids`, never solely against `docs`.
  const current = ctx.scan.docs.find((d) => d.node.id === input.id);
  const exists = current !== undefined || ctx.scan.ids.includes(input.id);
  const targetPath = current?.node.sourcePath ?? null;

  const rendered = renderDocument(cleanFields, input.body);
  const sourcePathForParse = current?.node.sourcePath ?? `__document__/${input.id}.md`;
  const parsed = parseDocument(rendered, sourcePathForParse);
  if (!parsed) {
    issues.push({ severity: 'error', code: 'schema', message: 'document content has no valid id/type frontmatter' });
    return { issues, rendered, targetPath, cleanFields, internalId: input.id };
  }
  if (!parsed.ok) {
    issues.push({ severity: 'error', code: 'schema', message: parsed.error });
    return { issues, rendered, targetPath, cleanFields, internalId: input.id };
  }

  if (!exists) {
    issues.push({ severity: 'error', code: 'stale_base', message: `${input.id} no longer exists` });
  } else if (input.baseHash !== undefined && (input.currentRawHash === undefined || input.currentRawHash !== input.baseHash)) {
    issues.push({ severity: 'error', code: 'stale_base', message: `${input.id} changed since this edit was opened; discard and re-open it` });
  }

  issues.push(...forbiddenFieldInjectionIssues(parsed.doc.frontmatter as unknown as Record<string, FieldValue>, current?.frontmatter as unknown as Record<string, FieldValue> | undefined));

  const others = ctx.scan.docs.filter((d) => d.node.id !== input.id);
  const overlaid: ParsedDoc[] = [...others, parsed.doc];
  const byId = new Map(overlaid.map((d) => [d.node.id, d]));
  // SDD-007: a link to a target `scan()` doesn't currently surface (e.g. still unpublished) is only a warning
  // while editing a working copy; publishing must resolve every link against what will actually ship.
  const linkSeverity: ValidationIssue['severity'] = input.mode === 'publish' ? 'error' : 'warning';
  for (const edge of parsed.doc.edges) {
    const target = byId.get(edge.to);
    if (!target) {
      issues.push({ severity: linkSeverity, code: 'broken_link', field: edge.type, message: `${edge.type} links to missing ${edge.to}` });
      continue;
    }
    if (!EXPECTED_TARGET[edge.type].includes(target.node.label)) {
      issues.push({ severity: linkSeverity, code: 'invalid_link_target', field: edge.type, message: `${edge.type} must target a ${EXPECTED_TARGET[edge.type].join(' or ')}, got ${target.node.label} (${edge.to})` });
    }
  }

  for (const issue of newLifecycleIssues(ctx.scan.docs, overlaid, ctx.grandfathered)) {
    issues.push({ severity: issue.severity, code: 'lifecycle', message: issue.message });
  }

  return { issues: dedupeForbiddenFieldIssues(issues), rendered, targetPath, cleanFields, internalId: input.id };
}
