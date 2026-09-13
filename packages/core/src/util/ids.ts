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

/**
 * Every frontmatter key must be a plain snake_case identifier. This is a security boundary, not just a style
 * rule: a key containing e.g. a newline (`"tags: []\\nstatus"`) would otherwise let a single JS object entry
 * render as two frontmatter lines, smuggling in an extra field that field-name-based checks (like
 * `forbiddenFieldIssues`, which only inspects the keys it was given) never see (WO-023 finding 6).
 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Renders frontmatter with JSON-encoded values (valid YAML) followed by the markdown body. Throws on any key that is not a plain snake_case identifier. */
export function renderDocument(fields: Record<string, FieldValue | null | undefined>, body: string): string {
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, FieldValue] => entry[1] !== undefined && entry[1] !== null)
    .map(([key, value]) => {
      if (!FIELD_KEY_PATTERN.test(key)) throw new Error(`invalid frontmatter field key: ${JSON.stringify(key)}`);
      return `${key}: ${JSON.stringify(value)}`;
    });
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}
