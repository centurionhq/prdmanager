export type FieldValue = string | number | boolean | string[] | Record<string, string>;

const FRONTMATTER = /^---\n([\s\S]*?)\n---(\n|$)/;
const KEY = /^[a-z_][a-z0-9_]*$/;

/** Rewrites only the given top-level frontmatter keys, preserving every other line (unlike a full YAML re-dump). */
export function setFrontmatterFields(content: string, fields: Record<string, FieldValue>): string {
  const normalized = content.replace(/\r\n?/g, '\n');
  const match = FRONTMATTER.exec(normalized);
  if (!match) throw new Error('document has no frontmatter block');

  let lines = (match[1] ?? '').split('\n');
  for (const [key, value] of Object.entries(fields)) {
    if (!KEY.test(key)) throw new Error(`invalid frontmatter key: ${key}`);
    lines = replaceKey(lines, key, `${key}: ${JSON.stringify(value)}`);
  }
  const rebuilt = `---\n${lines.join('\n')}\n---${match[2]}`;
  return rebuilt + normalized.slice(match[0].length);
}

function replaceKey(lines: string[], key: string, rendered: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return [...lines, rendered];
  let end = start + 1;
  while (end < lines.length && /^(\s+|\s*-\s)/.test(lines[end] ?? '') && !/^[a-z_]/i.test(lines[end] ?? '')) end++;
  return [...lines.slice(0, start), rendered, ...lines.slice(end)];
}
