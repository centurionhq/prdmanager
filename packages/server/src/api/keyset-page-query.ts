/**
 * Shared keyset-pagination query schema and cursor-decode-error wrapper (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-341/WO-342): both `/commits` (`./project-code-history.ts`) and
 * `/audit-log` (`./audit-log.ts`) page a `@prdm/db` keyset-paginated repository (`decodeCursor`/
 * `paginateKeyset`, see `packages/db/src/pagination.ts`) the same way — an opaque `cursor` plus a capped
 * `limit` — so this is the one place that shape/cap is declared, rather than each route redeclaring its
 * own copy that could quietly drift out of sync with the other.
 */
import { z } from 'zod';
import { ValidationError } from '../errors.js';

/** Same "named cap, not a bare number" convention as `../agent/tools/search-project.ts`'s own
 * `MAX_LIMIT` — a judgment call, not a spec requirement. */
export const MAX_PAGE_LIMIT = 200;

export const keysetPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
});

/**
 * Wraps a keyset-paginated repository call: `@prdm/db`'s `decodeCursor` throws a plain `Error` on a
 * malformed `cursor`, which — left unwrapped — would otherwise reach the global error handler as a
 * generic, unhandled 500 rather than the 400 a caller-supplied bad cursor actually is.
 */
export async function fetchKeysetPage<T>(fetch: () => Promise<T>): Promise<T> {
  try {
    return await fetch();
  } catch {
    throw new ValidationError('invalid cursor');
  }
}
