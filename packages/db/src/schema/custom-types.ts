/** drizzle-orm 0.45's pg-core has no built-in `bytea` column (unlike `jsonb`/`uuid`/...); `pg` already returns/accepts `bytea` as a plain `Buffer`, so no `toDriver`/`fromDriver` mapping is needed. */
import { customType } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
