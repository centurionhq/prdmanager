/**
 * Shared opaque keyset-cursor helpers (SDD-012, WO-332): every paginated listing in this package orders
 * newest-first by a `(timestamp, tiebreakerId)` pair and hands back a base64url-encoded cursor a caller
 * treats as opaque — never a raw `OFFSET`, which would skip/duplicate rows under concurrent writes.
 */
export interface KeysetCursor {
  timestamp: Date;
  id: string;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify({ timestamp: cursor.timestamp.toISOString(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | null | undefined): KeysetCursor | null {
  if (!cursor) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid pagination cursor');
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { timestamp?: unknown }).timestamp !== 'string' || typeof (parsed as { id?: unknown }).id !== 'string') {
    throw new Error('invalid pagination cursor');
  }
  const { timestamp, id } = parsed as { timestamp: string; id: string };
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error('invalid pagination cursor');
  return { timestamp: date, id };
}

/** Splits a keyset page fetched with `limit + 1` rows into the page itself plus the next cursor, `null` once there is nothing more. */
export function paginateKeyset<T>(rows: readonly T[], limit: number, keyOf: (row: T) => KeysetCursor): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { items, nextCursor: hasMore ? encodeCursor(keyOf(items[items.length - 1]!)) : null };
}
