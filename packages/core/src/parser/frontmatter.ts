import matter from 'gray-matter';
import {
  DEFAULT_STATUS,
  LABEL_BY_KIND,
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

const VOLATILE_FIELDS = new Set(['status', 'assigned_to', 'claimed_at', 'completed_at', 'resolved_by', 'blueprint_hashes']);

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
      governs: fm.type === 'SDD' || fm.type === 'ADR' || fm.type === 'WO' ? fm.governs : [],
      actor: actorOf(fm),
      frontmatter: fm,
    },
  };
}

function contentHash(fm: Frontmatter, body: string): string {
  const stable = Object.fromEntries(
    Object.entries(fm)
      .filter(([key]) => !VOLATILE_FIELDS.has(key))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return sha256(`${JSON.stringify(stable)}\n${body}`);
}

function edgesOf(fm: Frontmatter): GraphEdge[] {
  const to = (ids: string[], type: GraphEdge['type']): GraphEdge[] => [...new Set(ids)].map((id) => ({ from: fm.id, to: id, type }));
  switch (fm.type) {
    case 'MRD':
    case 'PRD':
    case 'FR':
      return to([...fm.implements, ...fm.evolves_from], 'EVOLVES_FROM');
    case 'SDD':
    case 'ADR':
      return to(fm.architects, 'ARCHITECTS');
    case 'WO':
      return to(fm.implements, 'IMPLEMENTS');
    case 'ART':
      return to(fm.provides_context_for, 'PROVIDES_CONTEXT_FOR');
    case 'FB':
      return to(fm.informs, 'INFORMS');
  }
}

function actorOf(fm: Frontmatter): Actor | null {
  if (fm.type !== 'WO' || !fm.assigned_to) return null;
  return { id: fm.assigned_to, kind: fm.assigned_to.startsWith('agent:') ? 'ai_agent' : 'developer' };
}

function extraProps(fm: Frontmatter): Record<string, PropValue> {
  switch (fm.type) {
    case 'SDD':
    case 'ADR':
      return { governs: fm.governs };
    case 'WO':
      return {
        assigned_to: fm.assigned_to ?? null,
        claimed_at: fm.claimed_at ?? null,
        completed_at: fm.completed_at ?? null,
        resolved_by: fm.resolved_by,
        governs: fm.governs,
        source_task: fm.source_task ?? null,
      };
    case 'ART':
      return { source: fm.source };
    case 'FB':
      return { source: fm.source, customer: fm.customer ?? null };
    default:
      return {};
  }
}
