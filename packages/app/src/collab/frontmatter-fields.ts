/**
 * Which `Y.Map('fm')` keys the frontmatter form shows per document kind, and how each one validates
 * (SDD-008 §"Editor": "formulario de frontmatter validado con @prdm/core/domain sin campos gestionados
 * por el servidor"). `@prdm/core/domain` is the one `@prdm/core` subpath `packages/app` may import values
 * from (its own `package.json` `exports` map, isomorphic, no filesystem/DB — unlike the main `@prdm/core`
 * entry, which `tests/unit/no-core-value-import.test.ts` forbids importing anything but types from).
 *
 * The field *list* per kind is hand-described here rather than derived by introspecting each zod
 * schema's shape at runtime: `@prdm/core/domain`'s schemas intentionally mix server-managed keys (`id`,
 * `status`, `closed_at`, ...) in with author-editable ones in the same object, so "which keys are safe to
 * show" isn't recoverable purely from the shape without re-encoding the exact same forbidden-fields list
 * `@prdm/core/authoring/forbidden-fields.ts` already owns server-side (that module isn't part of the
 * `./domain` export, by design — it's server/CLI-only authoring logic). Validation, though, always goes
 * through the real schema's own `.safeParse` — this file never reimplements a single validation rule.
 */
import { artifactSchema, blueprintSchema, featureSchema, feedbackSchema, type DocKind } from '@prdm/core/domain';
import type { FrontmatterValue } from '@prdm/collab';

export type FrontmatterWidget = 'text' | 'id-list' | 'string-list' | 'boolean';

export interface FrontmatterFieldDescriptor {
  key: string;
  label: string;
  widget: FrontmatterWidget;
  /** Short guidance shown under the field — mainly for `id-list` fields, where the expected format
   * (`KIND-NNN`, comma-separated) isn't obvious from the label alone. */
  hint?: string;
}

const TITLE_FIELD: FrontmatterFieldDescriptor = { key: 'title', label: 'Título', widget: 'text' };
const TAGS_FIELD: FrontmatterFieldDescriptor = { key: 'tags', label: 'Etiquetas', widget: 'string-list', hint: 'separadas por coma' };

const FEATURE_FIELDS: FrontmatterFieldDescriptor[] = [
  TITLE_FIELD,
  TAGS_FIELD,
  { key: 'implements', label: 'Implementa', widget: 'id-list', hint: 'ids separados por coma, p. ej. SDD-001' },
  { key: 'evolves_from', label: 'Evoluciona de', widget: 'id-list', hint: 'ids separados por coma' },
  { key: 'justified_by', label: 'Justificado por', widget: 'id-list', hint: 'ids separados por coma' },
];

const BLUEPRINT_FIELDS: FrontmatterFieldDescriptor[] = [
  TITLE_FIELD,
  TAGS_FIELD,
  { key: 'architects', label: 'Arquitecta a', widget: 'id-list', hint: 'ids separados por coma, al menos uno' },
  { key: 'impacts_paths', label: 'Rutas impactadas', widget: 'string-list', hint: 'rutas separadas por coma' },
];

const ARTIFACT_FIELDS: FrontmatterFieldDescriptor[] = [
  TITLE_FIELD,
  TAGS_FIELD,
  { key: 'source', label: 'Fuente', widget: 'text' },
  { key: 'provides_context_for', label: 'Da contexto a', widget: 'id-list', hint: 'ids separados por coma' },
  { key: 'root', label: 'Raíz (excepción de ciclo de vida)', widget: 'boolean' },
];

const FEEDBACK_FIELDS: FrontmatterFieldDescriptor[] = [
  TITLE_FIELD,
  TAGS_FIELD,
  { key: 'source', label: 'Fuente', widget: 'text' },
  { key: 'customer', label: 'Cliente', widget: 'text' },
  { key: 'informs', label: 'Informa a', widget: 'id-list', hint: 'ids separados por coma' },
  { key: 'root', label: 'Raíz (excepción de ciclo de vida)', widget: 'boolean' },
];

/** `[]` for `'WO'` — a work order is only ever generated from a blueprint's task list (SDD-002), never
 * authored through the collab editor, so it never has a frontmatter form at all. */
export function frontmatterFieldsForKind(kind: DocKind): FrontmatterFieldDescriptor[] {
  switch (kind) {
    case 'MRD':
    case 'PRD':
    case 'FR':
      return FEATURE_FIELDS;
    case 'SDD':
    case 'ADR':
      return BLUEPRINT_FIELDS;
    case 'ART':
      return ARTIFACT_FIELDS;
    case 'FB':
      return FEEDBACK_FIELDS;
    default:
      return [];
  }
}

function schemaForKind(kind: DocKind) {
  switch (kind) {
    case 'MRD':
    case 'PRD':
    case 'FR':
      return featureSchema;
    case 'SDD':
    case 'ADR':
      return blueprintSchema;
    case 'ART':
      return artifactSchema;
    case 'FB':
      return feedbackSchema;
    default:
      return null;
  }
}

/** Placeholder values for the server-managed fields `@prdm/core/domain`'s schema requires structurally
 * (`id`, `type`, ...) but this form never shows or edits — real values don't matter here, only that the
 * schema can run at all so it can validate the fields this form *does* own. */
function syntheticServerFields(kind: DocKind): Record<string, FrontmatterValue> {
  const base: Record<string, FrontmatterValue> = { id: `${kind}-001`, type: kind };
  if (kind === 'WO') base.status = 'pending';
  return base;
}

export interface FrontmatterValidationIssue {
  field: string;
  message: string;
}

/** Validates `fields` (the form's own editable keys only) against the real `@prdm/core/domain` schema for
 * `kind`, merged with harmless placeholders for the server-managed keys the schema also requires — issues
 * on those synthetic keys are never surfaced (this form can't fix them, and they're never really wrong). */
export function validateFrontmatterFields(kind: DocKind, fields: Record<string, FrontmatterValue>): FrontmatterValidationIssue[] {
  const schema = schemaForKind(kind);
  if (!schema) return [];
  const editableKeys = new Set(frontmatterFieldsForKind(kind).map((f) => f.key));
  const result = schema.safeParse({ ...syntheticServerFields(kind), ...fields });
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => typeof issue.path[0] === 'string' && editableKeys.has(issue.path[0]))
    .map((issue) => ({ field: String(issue.path[0]), message: issue.message }));
}
