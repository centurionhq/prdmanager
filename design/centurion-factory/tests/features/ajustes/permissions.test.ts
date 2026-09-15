import { describe, expect, it } from 'vitest';
import { hasPermission, PERMISSIONS_ORDER, PROJECT_ROLES } from '../../../src/features/ajustes/permissions';

describe('hasPermission', () => {
  it('lets everyone view', () => {
    for (const role of PROJECT_ROLES) {
      expect(hasPermission(role, 'view')).toBe(true);
    }
  });

  it('lets everyone except viewer comment', () => {
    expect(hasPermission('admin', 'comment')).toBe(true);
    expect(hasPermission('editor', 'comment')).toBe(true);
    expect(hasPermission('developer', 'comment')).toBe(true);
    expect(hasPermission('commenter', 'comment')).toBe(true);
    expect(hasPermission('viewer', 'comment')).toBe(false);
  });

  it('lets admin and editor edit documents', () => {
    expect(hasPermission('admin', 'edit')).toBe(true);
    expect(hasPermission('editor', 'edit')).toBe(true);
    expect(hasPermission('developer', 'edit')).toBe(false);
    expect(hasPermission('commenter', 'edit')).toBe(false);
    expect(hasPermission('viewer', 'edit')).toBe(false);
  });

  it('lets admin and developer claim work orders', () => {
    expect(hasPermission('admin', 'claimOrders')).toBe(true);
    expect(hasPermission('developer', 'claimOrders')).toBe(true);
    expect(hasPermission('editor', 'claimOrders')).toBe(false);
    expect(hasPermission('commenter', 'claimOrders')).toBe(false);
    expect(hasPermission('viewer', 'claimOrders')).toBe(false);
  });

  it('reserves publish, acknowledging drift, closing a feature and managing members to admin', () => {
    for (const permission of ['publish', 'acknowledgeDrift', 'closeFeature', 'manageMembers'] as const) {
      expect(hasPermission('admin', permission)).toBe(true);
      expect(hasPermission('editor', permission)).toBe(false);
      expect(hasPermission('developer', permission)).toBe(false);
      expect(hasPermission('commenter', permission)).toBe(false);
      expect(hasPermission('viewer', permission)).toBe(false);
    }
  });

  it('exposes every role and permission in a stable order for the matrix', () => {
    expect(PROJECT_ROLES).toEqual(['admin', 'editor', 'developer', 'commenter', 'viewer']);
    expect(PERMISSIONS_ORDER).toEqual([
      'view',
      'comment',
      'edit',
      'publish',
      'claimOrders',
      'acknowledgeDrift',
      'closeFeature',
      'manageMembers',
    ]);
  });
});
