export type FieldValue = string | number | boolean | string[] | Record<string, string>;

const FRONTMATTER = /^---\n([\s\S]*?)\n---(\n|$)/;
const KEY = /^[a-z_][a-z0-9_]*$/;

const UNQUOTED_KEY = /^([A-Za-z_][\w-]*)\s*:/;
const DOUBLE_QUOTED_KEY = /^"([^"]*)"\s*:/;
const SINGLE_QUOTED_KEY = /^'([^']*)'\s*:/;

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

/**
 * Renames a top-level frontmatter key in place, keeping its value (and any indented/continuation lines)
 * untouched. A no-op when `oldKey` is not present. Used by `prdm migrate docs` (e.g. `governs` -> `impacts_paths`)
 * so the value's original formatting survives, unlike `setFrontmatterFields`, which always re-renders as JSON.
 */
export function renameFrontmatterKey(content: string, oldKey: string, newKey: string): string {
  const normalized = content.replace(/\r\n?/g, '\n');
  const match = FRONTMATTER.exec(normalized);
  if (!match) throw new Error('document has no frontmatter block');

  const lines = (match[1] ?? '').split('\n');
  const start = lines.findIndex((line) => parseTopLevelKey(line) === oldKey);
  if (start === -1) return content;

  const renamed = replaceKeyName(lines[start] ?? '', oldKey, newKey);
  const nextLines = [...lines.slice(0, start), renamed, ...lines.slice(start + 1)];
  const rebuilt = `---\n${nextLines.join('\n')}\n---${match[2]}`;
  return rebuilt + normalized.slice(match[0].length);
}

/** Replaces only the key portion of a top-level `key:` line, preserving its quoting style and value. */
function replaceKeyName(line: string, oldKey: string, newKey: string): string {
  if (DOUBLE_QUOTED_KEY.test(line)) return line.replace(`"${oldKey}"`, `"${newKey}"`);
  if (SINGLE_QUOTED_KEY.test(line)) return line.replace(`'${oldKey}'`, `'${newKey}'`);
  return line.replace(new RegExp(`^${oldKey}(\\s*:)`), `${newKey}$1`);
}

/** Returns the key name of a top-level `key:` line (unquoted or quoted), or null for indented/non-key lines. */
function parseTopLevelKey(line: string): string | null {
  if (/^\s/.test(line)) return null;
  const doubleQuoted = DOUBLE_QUOTED_KEY.exec(line);
  if (doubleQuoted) return doubleQuoted[1] ?? null;
  const singleQuoted = SINGLE_QUOTED_KEY.exec(line);
  if (singleQuoted) return singleQuoted[1] ?? null;
  const unquoted = UNQUOTED_KEY.exec(line);
  return unquoted ? (unquoted[1] ?? null) : null;
}

/**
 * Finds the exclusive end of a key's block, starting right after the key line.
 * Blank lines are only absorbed when followed by more block content (indented, list,
 * or comment lines) before the next top-level key, so trailing blank lines before the
 * next key (or EOF) are preserved.
 */
function findBlockEnd(lines: string[], start: number): number {
  let end = start + 1;
  let cursor = start + 1;
  while (cursor < lines.length) {
    const line = lines[cursor] ?? '';
    if (line.trim() === '') {
      cursor++;
      continue;
    }
    if (parseTopLevelKey(line) !== null) break;
    end = cursor + 1;
    cursor++;
  }
  return end;
}

function replaceKey(lines: string[], key: string, rendered: string): string[] {
  const start = lines.findIndex((line) => parseTopLevelKey(line) === key);
  if (start === -1) return [...lines, rendered];
  const end = findBlockEnd(lines, start);
  return [...lines.slice(0, start), rendered, ...lines.slice(end)];
}
