/**
 * Generic search, filter and sort helpers shared by every list view (SDD-011).
 * Kept free of src/data imports so screens can compose them with their own row shapes.
 */

const DIACRITICS_PATTERN = /[̀-ͯ]/g;

/** Lowercases and strips diacritics so comparisons ignore accents and case. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS_PATTERN, '').toLowerCase();
}

/**
 * Keeps items where every whitespace-separated term of `query` matches at least one field,
 * accent- and case-insensitively. An empty (or whitespace-only) query keeps every item.
 */
export function searchItems<T>(items: readonly T[], query: string, fields: (item: T) => readonly string[]): T[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];

  return items.filter((item) => {
    const values = fields(item).map(normalize);
    return terms.every((term) => values.some((value) => value.includes(term)));
  });
}

/** Keeps items that satisfy every predicate (logical AND). */
export function filterItems<T>(items: readonly T[], predicates: readonly ((item: T) => boolean)[]): T[] {
  return items.filter((item) => predicates.every((predicate) => predicate(item)));
}

function compareDefined(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es');
}

/**
 * Returns a new, stably sorted array. Undefined values always sort last, regardless of
 * direction. Never mutates `items`.
 */
export function sortItems<T>(
  items: readonly T[],
  getValue: (item: T) => string | number | undefined,
  direction: 'asc' | 'desc',
): T[] {
  const decorated = items.map((item, index) => ({ item, value: getValue(item), index }));

  decorated.sort((a, b) => {
    if (a.value === undefined && b.value === undefined) return a.index - b.index;
    if (a.value === undefined) return 1;
    if (b.value === undefined) return -1;
    const compared = compareDefined(a.value, b.value);
    if (compared !== 0) return direction === 'asc' ? compared : -compared;
    return a.index - b.index;
  });

  return decorated.map((entry) => entry.item);
}

export type SortState<K extends string> = {
  readonly key: K;
  readonly direction: 'asc' | 'desc';
};

/** Toggles direction when re-selecting the same key; otherwise starts ascending on the new key. */
export function toggleSort<K extends string>(current: SortState<K> | undefined, key: K): SortState<K> {
  if (current?.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
}
