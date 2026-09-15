/**
 * Pure anti-spoofing check for an incoming Yjs update (SDD-008 §"Autoría por línea no falsificable").
 * No I/O — `packages/server`'s `beforeSync` hook (WO-150) decodes the update with
 * `../update-ranges.js`, reads the server's current state vector and looks up `doc_client_bindings`,
 * then calls {@link checkUpdateAgainstBindings} with the results.
 *
 * The rule, per struct client id present in the update:
 * - `range.from > known` (the server's current clock for that client): the update assumes structs
 *   before `from` that the server doesn't have — a gap that would leave `pendingStructs` behind if
 *   applied. Rejected unconditionally (SDD-008: "que deje pendingStructs").
 * - `range.to <= known`: every struct in this range is already in the server's state — an honest
 *   resend (e.g. a client reconnecting after a server restart re-sends history it already sent).
 *   Always allowed, *regardless* of binding — SDD-008 is explicit that this must never disconnect an
 *   honest client just because the server forgot who a client id belonged to across a restart.
 * - Otherwise (`from <= known < to`, i.e. genuinely new content from this client): allowed only if the
 *   client id has no binding yet (a brand-new client, bound by the caller right after this check
 *   passes) or is already bound to the *same* user as this connection. Bound to a different user:
 *   rejected.
 *
 * Delete sets are simpler: every deleted `(client, clock, len)` must already be within the server's
 * state vector for that client — deleting something the server was never told exists indicates a client
 * id used incoherently, rejected unconditionally.
 */
import type { DeleteRange, StructRange } from './update-ranges.js';

export interface AntiSpoofCheckParams {
  structRanges: readonly StructRange[];
  deleteRanges: readonly DeleteRange[];
  /** The server's current per-client known clock (`Y.decodeStateVector(Y.encodeStateVector(doc))`),
   * taken *before* this update is applied. */
  serverStateVector: ReadonlyMap<number, number>;
  /** `undefined` means the client id has no binding yet on this document. */
  lookupBinding: (client: number) => string | undefined;
  connectionUserId: string;
}

export interface AntiSpoofCheckResult {
  ok: boolean;
  /** Present only when `ok` is `false` — safe to put in an audit log (no secrets, just numeric ids). */
  reason?: string;
}

export function checkUpdateAgainstBindings(params: AntiSpoofCheckParams): AntiSpoofCheckResult {
  const { structRanges, deleteRanges, serverStateVector, lookupBinding, connectionUserId } = params;

  for (const range of structRanges) {
    const known = serverStateVector.get(range.client) ?? 0;

    if (range.from > known) {
      return {
        ok: false,
        reason: `client ${range.client}: update starts at clock ${range.from} but the server only has ${known} (missing dependency / pendingStructs)`,
      };
    }

    if (range.to > known) {
      const boundUser = lookupBinding(range.client);
      if (boundUser !== undefined && boundUser !== connectionUserId) {
        return { ok: false, reason: `client ${range.client} is bound to a different user` };
      }
    }
    // else: range.to <= known -> fully contained already; an honest resend, always allowed.
  }

  for (const range of deleteRanges) {
    const known = serverStateVector.get(range.client) ?? 0;
    if (range.clock + range.len > known) {
      return {
        ok: false,
        reason: `client ${range.client}: delete set references clock range [${range.clock}, ${range.clock + range.len}) beyond the server's known ${known}`,
      };
    }
  }

  return { ok: true };
}
