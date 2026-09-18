import matter from 'gray-matter';
import {
  DEFAULT_STATUS,
  LABEL_BY_KIND,
  frontmatterAliasConflict,
  frontmatterDeprecations,
  frontmatterSchema,
  kindOfId,
  type Actor,
  type Frontmatter,
  type GraphEdge,
  type ParsedDoc,
  type PropValue,
} from '../domain/schema.js';
import { normalizeText, sha256 } from '../util/hash.js';

export type ParseResult = { ok: true; doc: ParsedDoc } | { ok: false; path: string; error: string };

const refuseExecutableFrontmatter = (): never => {
  throw new Error('executable front matter engines are not allowed');
};
// Any options object also disables gray-matter's content-keyed cache, which returns shared mutable results.
const SAFE_MATTER_OPTIONS = {
  language: 'yaml',
  engines: { js: refuseExecutableFrontmatter, javascript: refuseExecutableFrontmatter, coffee: refuseExecutableFrontmatter },
};

const VOLATILE_FIELDS = new Set([
  'status',
  'assigned_to',
  'claimed_at',
  'completed_at',
  'resolved_by',
  'blueprint_hashes',
  'closed_at',
  'closed_by',
  // SDD-018 "Archivado de Work Orders": same reasoning as closed_at/closed_by above -- archiving/force-
  // closing must never make a document look "changed" against its already-acknowledged baseline.
  'archived_at',
  'archived_by',
  'archive_reason',
  'close_reason',
  'closed_forced',
]);

export function parseDocument(content: string, sourcePath: string): ParseResult | null {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return null;

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(normalized, SAFE_MATTER_OPTIONS);
  } catch (err) {
    return { ok: false, path: sourcePath, error: `invalid YAML frontmatter: ${(err as Error).message}` };
  }
  const data = parsed.data as Record<string, unknown>;
  if (typeof data.id !== 'string' || typeof data.type !== 'string') return null;

  const conflict = frontmatterAliasConflict(data);
  if (conflict) return { ok: false, path: sourcePath, error: conflict };

  const validation = frontmatterSchema.safeParse(data);
  if (!validation.success) {
    const issues = validation.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return { ok: false, path: sourcePath, error: issues };
  }
  const fm = validation.data;
  if (kindOfId(fm.id) !== fm.type) {
    return { ok: false, path: sourcePath, error: `id prefix of ${fm.id} does not match type ${fm.type}` };
  }

  const label = LABEL_BY_KIND[fm.type];
  const body = normalizeText(parsed.content);
  const node = {
    id: fm.id,
    label,
    kind: fm.type,
    title: fm.title,
    body,
    status: fm.status ?? DEFAULT_STATUS[label],
    tags: fm.tags,
    sourcePath,
    createdAt: fm.created_at ?? null,
    contentHash: contentHash(fm, body),
    props: extraProps(fm),
  };

  return {
    ok: true,
    doc: {
      node,
      edges: edgesOf(fm),
      impactsPaths: fm.type === 'SDD' || fm.type === 'ADR' || fm.type === 'WO' ? fm.impacts_paths : [],
      actor: actorOf(fm),
      frontmatter: fm,
      deprecations: frontmatterDeprecations(data),
    },
  };
}

export interface ContentHashOptions {
  /**
   * Include the `## Tareas`/`## Tasks` section of a blueprint in the hash (ADR-002 D9 legacy behavior).
   * Used by `prdm migrate docs` to recompute the hash that matches a pre-migration baseline entry.
   */
  includeTasks?: boolean;
}

const TASKS_HEADING = /^##\s+(Tareas|Tasks)\s*$/im;
const NEXT_HEADING = /^##\s+.+$/m;

/** Removes the `## Tareas`/`## Tasks` heading through the line before the next `## ` heading (or EOF). */
function stripTasksSection(body: string): string {
  const heading = TASKS_HEADING.exec(body);
  if (!heading) return body;
  const restStart = heading.index + heading[0].length;
  const rest = body.slice(restStart);
  const next = NEXT_HEADING.exec(rest);
  const sectionEnd = next ? restStart + next.index : body.length;
  return body.slice(0, heading.index) + body.slice(sectionEnd);
}

/**
 * ADR-002 D9: the hashed key set is stable across the `impacts_paths` rename (hashed under the historical
 * `governs` key) and across the WO `todo`/`pending` status alias (status is already volatile). Blueprints
 * exclude their `## Tareas`/`## Tasks` section by default so checking off tasks never invalidates a WO.
 */
export function contentHash(fm: Frontmatter, body: string, options: ContentHashOptions = {}): string {
  const isBlueprint = fm.type === 'SDD' || fm.type === 'ADR';
  const hashedBody = isBlueprint && !options.includeTasks ? stripTasksSection(body) : body;
  const stable = Object.fromEntries(
    Object.entries(fm)
      .filter(([key, value]): boolean => !VOLATILE_FIELDS.has(key) && value !== undefined)
      .map(([key, value]): [string, unknown] => [key === 'impacts_paths' ? 'governs' : key, value])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return sha256(`${JSON.stringify(stable)}\n${hashedBody}`);
}

/**
 * `JUSTIFIED_BY` (Feature -> Feedback|Artifact, SDD-002 "Grafo multi-proyecto") is derived from the *reverse* of
 * `INFORMS`/`PROVIDES_CONTEXT_FOR` in addition to a Feature's own explicit `justified_by`. A single-document
 * `edgesOf` call can still emit the reverse edge for an FB/ART document: the edge's `from` is the feature id
 * (not `fm.id`), which is safe because every consumer of `ParsedDoc.edges` (link validation, graph writes) reads
 * `edge.from`/`edge.to` directly and never assumes `edge.from === fm.id`. Explicit + derived edges are deduped
 * by whoever aggregates edges across documents (e.g. Neo4j's `MERGE_EDGES` is idempotent per (from, to, type)).
 */
function reverseJustifiedBy(sourceIds: string[], targetId: string): GraphEdge[] {
  return [...new Set(sourceIds)].map((from) => ({ from, to: targetId, type: 'JUSTIFIED_BY' as const }));
}

function edgesOf(fm: Frontmatter): GraphEdge[] {
  const to = (ids: string[], type: GraphEdge['type']): GraphEdge[] => [...new Set(ids)].map((id) => ({ from: fm.id, to: id, type }));
  switch (fm.type) {
    case 'MRD':
    case 'PRD':
    case 'FR':
      return [...to([...fm.implements, ...fm.evolves_from], 'EVOLVES_FROM'), ...to(fm.justified_by ?? [], 'JUSTIFIED_BY')];
    case 'SDD':
    case 'ADR':
      return to(fm.architects, 'ARCHITECTS');
    case 'WO':
      return to(fm.implements, 'IMPLEMENTS');
    case 'ART':
      return [...to(fm.provides_context_for, 'PROVIDES_CONTEXT_FOR'), ...reverseJustifiedBy(fm.provides_context_for, fm.id)];
    case 'FB':
      return [...to(fm.informs, 'INFORMS'), ...reverseJustifiedBy(fm.informs, fm.id)];
    case 'BC':
      // PRD-011/SDD-022 (WO-437): a BC has no implements/evolves_from (it is not a blueprint), only the
      // JUSTIFIED_BY edge every Feature-label kind gets from its own justified_by.
      return to(fm.justified_by ?? [], 'JUSTIFIED_BY');
  }
}

function actorOf(fm: Frontmatter): Actor | null {
  if (fm.type !== 'WO' || !fm.assigned_to) return null;
  return { id: fm.assigned_to, kind: fm.assigned_to.startsWith('agent:') ? 'ai_agent' : 'developer' };
}

function extraProps(fm: Frontmatter): Record<string, PropValue> {
  switch (fm.type) {
    case 'MRD':
    case 'PRD':
    case 'FR':
      return {
        justified_by: fm.justified_by ?? [],
        closed_at: fm.closed_at ?? null,
        closed_by: fm.closed_by ?? null,
        // SDD-018 "Cierre forzado auditado": same audit-visibility treatment as closed_at/closed_by above.
        close_reason: fm.close_reason ?? null,
        closed_forced: fm.closed_forced ?? false,
      };
    case 'SDD':
    case 'ADR':
      return { impacts_paths: fm.impacts_paths };
    case 'WO':
      return {
        assigned_to: fm.assigned_to ?? null,
        claimed_at: fm.claimed_at ?? null,
        completed_at: fm.completed_at ?? null,
        resolved_by: fm.resolved_by,
        impacts_paths: fm.impacts_paths,
        source_task: fm.source_task ?? null,
        // SDD-018 "Archivado de Work Orders": same audit-visibility treatment as the fields above.
        archived_at: fm.archived_at ?? null,
        archived_by: fm.archived_by ?? null,
        archive_reason: fm.archive_reason ?? null,
      };
    case 'ART':
      return { source: fm.source, root: fm.root ?? false };
    case 'FB':
      return { source: fm.source, customer: fm.customer ?? null, root: fm.root ?? false };
    case 'BC':
      // Same shape as MRD/PRD/FR above: businessCaseSchema mirrors featureSchema's justified_by/
      // closed_*/close_reason/closed_forced fields exactly (see its own doc comment).
      return {
        justified_by: fm.justified_by ?? [],
        closed_at: fm.closed_at ?? null,
        closed_by: fm.closed_by ?? null,
        close_reason: fm.close_reason ?? null,
        closed_forced: fm.closed_forced ?? false,
      };
    default:
      return {};
  }
}
