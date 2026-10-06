import { describe, expect, test } from 'vitest';
import { REMOTE_WRITE_TOOL_NAMES } from '../../src/tools-remote.js';

/**
 * WO-416 (SDD-018): `packages/server/src/api/mcp-remote.ts`'s own `REMOTE_WRITE_TOOL_NAMES` used to be a
 * second, hand-maintained copy of this list that had gone stale (missing `generate_work_orders`/
 * `add_blueprint_task`). This module is now the single source of truth: it lists every tool
 * `registerRemoteWriteTools` actually registers, and `mcp-remote.ts` imports it instead of maintaining
 * its own copy.
 */
describe('REMOTE_WRITE_TOOL_NAMES', () => {
  test('lists exactly every write tool registerRemoteWriteTools registers', () => {
    expect([...REMOTE_WRITE_TOOL_NAMES].sort()).toEqual(
      ['add_blueprint_task', 'archive_work_order', 'claim_work_order', 'close_feedback', 'complete_work_order', 'dismiss_feedback', 'generate_work_orders', 'link_feedback', 'submit_feedback'].sort(),
    );
  });
});
