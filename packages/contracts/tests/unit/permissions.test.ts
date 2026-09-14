/**
 * Exhaustive table-driven tests for `can` (SDD-006 §Permisos, WO-106): every project role (including
 * "no role at all") crossed with every action, matched against the SDD-006 §Permisos table transcribed
 * verbatim, plus the org-role inheritance and default-deny rules.
 */
import { describe, expect, test } from 'vitest';
import { PERMISSION_ACTIONS, PROJECT_ROLES, can, type PermissionAction, type ProjectRole } from '../../src/permissions.js';

/** SDD-006 §Permisos, transcribed directly from the table (admin | editor | developer | commenter | viewer). */
const EXPECTED_ROLES_BY_ACTION: Record<PermissionAction, readonly ProjectRole[]> = {
  view: ['admin', 'editor', 'developer', 'commenter', 'viewer'],
  comment: ['admin', 'editor', 'developer', 'commenter'],
  submit_feedback: ['admin', 'editor', 'developer', 'commenter'],
  delete_others_comments: ['admin'],
  edit_document: ['admin', 'editor'],
  request_review: ['admin', 'editor'],
  restore_version: ['admin', 'editor'],
  use_agent: ['admin', 'editor'],
  accept_agent_proposal: ['admin', 'editor'],
  publish: ['admin'],
  archive: ['admin'],
  acknowledge_drift: ['admin'],
  close_feature: ['admin'],
  claim_work_order: ['admin', 'editor', 'developer'],
  complete_work_order: ['admin', 'editor', 'developer'],
  report_code_preview: ['admin', 'editor', 'developer'],
  manage_members: ['admin'],
  manage_project_settings: ['admin'],
  manage_ci_tokens: ['admin'],
  import: ['admin'],
};

describe('can (WO-106) — exhaustive project-role x action matrix', () => {
  test('every action is covered by the expectation table (sanity: no drift between test and source)', () => {
    expect(Object.keys(EXPECTED_ROLES_BY_ACTION).sort()).toEqual([...PERMISSION_ACTIONS].sort());
  });

  for (const action of PERMISSION_ACTIONS) {
    for (const role of PROJECT_ROLES) {
      const expected = EXPECTED_ROLES_BY_ACTION[action].includes(role);
      test(`${role} ${expected ? 'can' : 'cannot'} ${action}`, () => {
        expect(can({ projectRole: role }, action)).toBe(expected);
      });
    }

    test(`no project role at all cannot ${action} (default deny)`, () => {
      expect(can({}, action)).toBe(false);
    });
  }
});

describe('can (WO-106) — org-role inheritance', () => {
  for (const action of PERMISSION_ACTIONS) {
    test(`org owner can always ${action} regardless of projectRole (inherits project admin)`, () => {
      expect(can({ orgRole: 'owner' }, action)).toBe(true);
      expect(can({ orgRole: 'owner', projectRole: 'viewer' }, action)).toBe(true);
    });

    test(`org admin can always ${action} regardless of projectRole (inherits project admin)`, () => {
      expect(can({ orgRole: 'admin' }, action)).toBe(true);
      expect(can({ orgRole: 'admin', projectRole: 'viewer' }, action)).toBe(true);
    });
  }

  test('a plain org member with no project_members row is denied every action (default deny)', () => {
    for (const action of PERMISSION_ACTIONS) {
      expect(can({ orgRole: 'member' }, action)).toBe(false);
    }
  });

  test('a plain org member falls back to their actual projectRole when they have one', () => {
    expect(can({ orgRole: 'member', projectRole: 'editor' }, 'edit_document')).toBe(true);
    expect(can({ orgRole: 'member', projectRole: 'editor' }, 'publish')).toBe(false);
    expect(can({ orgRole: 'member', projectRole: 'viewer' }, 'view')).toBe(true);
    expect(can({ orgRole: 'member', projectRole: 'viewer' }, 'comment')).toBe(false);
  });
});
