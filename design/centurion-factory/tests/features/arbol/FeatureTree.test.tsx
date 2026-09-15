import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/data';
import { FeatureTree } from '../../../src/features/arbol/FeatureTree';

function feature(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    kind: 'PRD',
    title: `Título de ${id}`,
    status: 'approved',
    station: 'ejecucion',
    justifiedBy: [],
    blueprintIds: [],
    createdAt: '2026-09-12',
    sample: false,
    ...overrides,
  };
}

const FEATURES: readonly Feature[] = [
  feature('MRD-001'),
  feature('PRD-001', { evolvesFrom: 'MRD-001' }),
  feature('PRD-002', { evolvesFrom: 'PRD-001', status: 'closed' }),
  feature('FR-001', { kind: 'FR', evolvesFrom: 'PRD-002' }),
];

let lastPathname: string | undefined;

function renderTree(selectedId: string) {
  const router = createMemoryRouter(
    [
      { path: '/arbol/:id?', element: <FeatureTree features={FEATURES} selectedId={selectedId} /> },
      { path: '*', element: <p>otro</p> },
    ],
    { initialEntries: [`/arbol/${selectedId}`] },
  );
  router.subscribe((state) => {
    lastPathname = state.location.pathname;
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('FeatureTree', () => {
  it('renders an ARIA tree with a treeitem per feature', () => {
    renderTree('PRD-002');
    expect(screen.getByRole('tree', { name: 'Árbol de features' })).toBeTruthy();
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
  });

  it('sets aria-level, aria-setsize and aria-posinset', () => {
    renderTree('PRD-002');
    const root = screen.getByRole('treeitem', { name: /MRD-001/ });
    expect(root.getAttribute('aria-level')).toBe('1');
    expect(root.getAttribute('aria-setsize')).toBe('1');
    expect(root.getAttribute('aria-posinset')).toBe('1');
    const child = screen.getByRole('treeitem', { name: /FR-001/ });
    expect(child.getAttribute('aria-level')).toBe('4');
  });

  it('marks the selected feature with aria-selected and the rest as false', () => {
    renderTree('PRD-002');
    expect(screen.getByRole('treeitem', { name: /PRD-002/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('treeitem', { name: /MRD-001/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('marks nodes with children as aria-expanded and leaves without the attribute', () => {
    renderTree('PRD-002');
    expect(screen.getByRole('treeitem', { name: /MRD-001/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('treeitem', { name: /FR-001/ }).hasAttribute('aria-expanded')).toBe(false);
  });

  it('shows the computed feature and closed counts', () => {
    renderTree('MRD-001');
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText(/features,/)).toBeTruthy();
  });

  it('uses a roving tabindex: only one treeitem is tabbable at a time', () => {
    renderTree('PRD-002');
    const items = screen.getAllByRole('treeitem');
    const tabbable = items.filter((item) => item.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.getAttribute('data-id')).toBe('PRD-002');
  });

  it('moves the roving tabindex with ArrowDown/ArrowUp', async () => {
    const user = userEvent.setup();
    renderTree('MRD-001');
    const root = screen.getByRole('treeitem', { name: /MRD-001/ });
    root.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: /PRD-001/ }).getAttribute('tabindex')).toBe('0');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('treeitem', { name: /MRD-001/ }).getAttribute('tabindex')).toBe('0');
  });

  it('Home and End jump to the first and last visible rows', async () => {
    const user = userEvent.setup();
    renderTree('MRD-001');
    screen.getByRole('treeitem', { name: /PRD-001/ }).focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('treeitem', { name: /FR-001/ }).getAttribute('tabindex')).toBe('0');
    await user.keyboard('{Home}');
    expect(screen.getByRole('treeitem', { name: /MRD-001/ }).getAttribute('tabindex')).toBe('0');
  });

  it('ArrowLeft collapses an expanded node and hides its descendants', async () => {
    const user = userEvent.setup();
    renderTree('MRD-001');
    screen.getByRole('treeitem', { name: /MRD-001/ }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: /MRD-001/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('treeitem', { name: /PRD-001/ })).toBeNull();
  });

  it('ArrowRight re-expands a collapsed node', async () => {
    const user = userEvent.setup();
    renderTree('MRD-001');
    const root = screen.getByRole('treeitem', { name: /MRD-001/ });
    root.focus();
    await user.keyboard('{ArrowLeft}{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /MRD-001/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('treeitem', { name: /PRD-001/ })).toBeTruthy();
  });

  it('Enter navigates to /arbol/<id> for the focused row', async () => {
    const user = userEvent.setup();
    renderTree('MRD-001');
    screen.getByRole('treeitem', { name: /PRD-001/ }).focus();
    await user.keyboard('{Enter}');
    expect(lastPathname).toBe('/arbol/PRD-001');
  });

  it('Space also navigates to /arbol/<id>', async () => {
    const user = userEvent.setup();
    renderTree('MRD-001');
    screen.getByRole('treeitem', { name: /PRD-001/ }).focus();
    await user.keyboard(' ');
    expect(lastPathname).toBe('/arbol/PRD-001');
  });

  it('clicking a row navigates to it as well', async () => {
    const user = userEvent.setup();
    renderTree('MRD-001');
    await user.click(screen.getByRole('treeitem', { name: /FR-001/ }));
    expect(lastPathname).toBe('/arbol/FR-001');
  });

  it('offers Contraer todo, which becomes Expandir todo once everything is collapsed', async () => {
    const user = userEvent.setup();
    renderTree('MRD-001');
    await user.click(screen.getByRole('button', { name: 'Contraer todo' }));
    expect(screen.getByRole('button', { name: 'Expandir todo' })).toBeTruthy();
    expect(within(screen.getByRole('tree')).getAllByRole('treeitem')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Expandir todo' }));
    expect(within(screen.getByRole('tree')).getAllByRole('treeitem')).toHaveLength(4);
  });
});
