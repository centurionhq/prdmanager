import { describe, expect, it } from 'vitest';
import { buildPrimaryNav, initialsFor, projectBasePath, projectRoleLabel } from '../../src/components/shell/project-nav.js';

describe('projectBasePath', () => {
  it('builds the /o/:org/p/:project prefix', () => {
    expect(projectBasePath('acme', 'factory')).toBe('/o/acme/p/factory');
  });
});

describe('buildPrimaryNav', () => {
  it('builds every nav item off the real org/project slugs', () => {
    const items = buildPrimaryNav('acme', 'factory');
    expect(items.map((item) => item.to)).toEqual([
      '/o/acme/p/factory',
      '/o/acme/p/factory/arbol',
      '/o/acme/p/factory/documents',
      '/o/acme/p/factory/ordenes',
      '/o/acme/p/factory/drift',
      '/o/acme/p/factory/entrada',
    ]);
  });

  it('marks only the index (Planta) item as an exact match', () => {
    const items = buildPrimaryNav('acme', 'factory');
    expect(items.find((item) => item.label === 'Planta')?.end).toBe(true);
    expect(items.filter((item) => item.label !== 'Planta').every((item) => item.end === false)).toBe(true);
  });
});

describe('projectRoleLabel', () => {
  it('translates every known project role', () => {
    expect(projectRoleLabel('admin')).toBe('Admin de proyecto');
    expect(projectRoleLabel('editor')).toBe('Editor');
    expect(projectRoleLabel('developer')).toBe('Developer');
    expect(projectRoleLabel('commenter')).toBe('Comentarista');
    expect(projectRoleLabel('viewer')).toBe('Viewer');
  });

  it('falls back to a generic label with no role', () => {
    expect(projectRoleLabel(undefined)).toBe('Sin rol asignado');
  });
});

describe('initialsFor', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFor('Ana Ríos')).toBe('AR');
  });

  it('falls back to the first two characters with a single word', () => {
    expect(initialsFor('ana')).toBe('AN');
  });
});
