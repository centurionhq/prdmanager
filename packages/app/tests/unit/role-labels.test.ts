import { ORG_ROLES, PROJECT_ROLES } from '@prdm/contracts';
import { describe, expect, it } from 'vitest';
import { ORG_ROLE_LABELS, orgRoleLabel, PROJECT_ROLE_LABELS, projectRoleLabel } from '../../src/lib/role-labels.js';

describe('projectRoleLabel', () => {
  it('translates every known project role', () => {
    expect(projectRoleLabel('admin')).toBe('Administrador');
    expect(projectRoleLabel('editor')).toBe('Editor');
    expect(projectRoleLabel('developer')).toBe('Developer');
    expect(projectRoleLabel('commenter')).toBe('Comentarista');
    expect(projectRoleLabel('viewer')).toBe('Lector');
  });

  it('falls back to a generic label with no role', () => {
    expect(projectRoleLabel(undefined)).toBe('Sin rol asignado');
    expect(projectRoleLabel('')).toBe('Sin rol asignado');
  });

  it('shows an unknown slug as is', () => {
    expect(projectRoleLabel('architect')).toBe('architect');
  });
});

describe('orgRoleLabel', () => {
  it('translates every known organization role', () => {
    expect(orgRoleLabel('owner')).toBe('Dueño');
    expect(orgRoleLabel('admin')).toBe('Administrador');
    expect(orgRoleLabel('member')).toBe('Miembro');
  });

  it('shows an unknown slug as is', () => {
    expect(orgRoleLabel('architect')).toBe('architect');
  });
});

describe('label maps', () => {
  it('has one entry per contract role', () => {
    for (const role of PROJECT_ROLES) expect(PROJECT_ROLE_LABELS[role]).toBeTruthy();
    for (const role of ORG_ROLES) expect(ORG_ROLE_LABELS[role]).toBeTruthy();
    expect(Object.keys(PROJECT_ROLE_LABELS)).toHaveLength(PROJECT_ROLES.length);
    expect(Object.keys(ORG_ROLE_LABELS)).toHaveLength(ORG_ROLES.length);
  });
});
