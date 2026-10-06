/**
 * WO-578 (SDD-056/PRD-036 R2): the sub-navigation of a section, as a design-system component rather than
 * markup each screen builds for itself.
 */
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SubNav, type SubNavGroup } from '../../src/components/index.js';

const GROUPS: readonly SubNavGroup[] = [
  { title: 'Proyecto web', items: [{ to: '/s/general', label: 'General' }, { to: '/s/miembros', label: 'Miembros' }] },
  { title: 'Tu cuenta', items: [{ to: '/s/perfil', label: 'Perfil' }] },
];

function renderNav(path: string) {
  const router = createMemoryRouter([{ path: '/s/*', element: <SubNav label="Ajustes" groups={GROUPS} /> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe('SubNav (WO-578, SDD-056)', () => {
  it('is one navigation landmark, named by its label', () => {
    renderNav('/s/general');

    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Ajustes' })).toBeTruthy();
  });

  it('draws each group under its own title, in the order given', () => {
    renderNav('/s/general');

    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label') ?? g.textContent)).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: 'Proyecto web' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['General', 'Miembros']);
    expect(within(screen.getByRole('group', { name: 'Tu cuenta' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['Perfil']);
  });

  it('every item is a real link to its destination', () => {
    renderNav('/s/general');

    expect(screen.getByRole('link', { name: 'Miembros' }).getAttribute('href')).toBe('/s/miembros');
    expect(screen.getByRole('link', { name: 'Perfil' }).getAttribute('href')).toBe('/s/perfil');
  });

  it('marks exactly the current destination, for assistive technology and not only by colour', () => {
    renderNav('/s/miembros');

    expect(screen.getByRole('link', { name: 'Miembros' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Perfil' }).getAttribute('aria-current')).toBeNull();
  });

  it('an empty group is not drawn: a title with nothing under it is noise', () => {
    const router = createMemoryRouter(
      [{ path: '/s/*', element: <SubNav label="Ajustes" groups={[{ title: 'Vacío', items: [] }, ...GROUPS]} /> }],
      { initialEntries: ['/s/general'] },
    );
    render(<RouterProvider router={router} />);

    expect(screen.queryByRole('group', { name: 'Vacío' })).toBeNull();
  });
});
