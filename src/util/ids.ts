import type { DocKind } from '../domain/schema.js';
import type { FieldValue } from '../parser/frontmatter-edit.js';

export function nextId(kind: DocKind, existingIds: Iterable<string>): string {
  const pattern = new RegExp(`^${kind}-(\\d+)$`);
  let max = 0;
  for (const id of existingIds) {
    const n = Number(pattern.exec(id)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return `${kind}-${String(max + 1).padStart(3, '0')}`;
}

const MAX_SLUG = 50;

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || 'doc';
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Renders frontmatter with JSON-encoded values (valid YAML) followed by the markdown body. */
export function renderDocument(fields: Record<string, FieldValue | null | undefined>, body: string): string {
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, FieldValue] => entry[1] !== undefined && entry[1] !== null)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}
