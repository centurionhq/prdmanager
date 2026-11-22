/**
 * The second line of a token's plate inside `ConfirmDialog` (SDD-062/WO-718): the identifier that tells two
 * tokens apart and when it last ran, in the same words the table already uses ("Sin usar"). Never the name --
 * that is the plate's own `name` -- and never the secret.
 */
import type { TokenSummaryDto } from '@prdm/contracts';
import { formatDate } from './format-date.js';

export function tokenResourceMeta(token: TokenSummaryDto): string {
  return `${token.prefix} · ${token.lastUsedAt ? `Último uso ${formatDate(token.lastUsedAt)}` : 'Sin usar'}`;
}
