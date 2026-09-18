import { describe, expect, test } from 'vitest';
import { DRAFT_KINDS } from '../../src/authoring/types.js';

/** PRD-011 §4.1/SDD-022 (WO-436): BC is draftable like every other Feature-label kind, so it can be
 * created equally from the dashboard's draft flow and from the remote MCP's create_document. WO is
 * still the only exclusion -- always generated, never drafted. */
describe('DRAFT_KINDS includes BC (WO-436)', () => {
  test('BC is draftable', () => {
    expect(DRAFT_KINDS).toContain('BC');
  });

  test('WO is still excluded', () => {
    expect(DRAFT_KINDS).not.toContain('WO');
  });
});
