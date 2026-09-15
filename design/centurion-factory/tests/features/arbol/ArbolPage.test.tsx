import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('ArbolPage', () => {
  it('shows a skeleton while loading', () => {
    renderAt('/arbol?estado=cargando');
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('shows an error state with a retry action', () => {
    renderAt('/arbol?estado=error');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('shows the empty state', () => {
    renderAt('/arbol?estado=vacio');
    expect(screen.getByText('Todavía no hay features')).toBeTruthy();
  });

  it('selects MRD-001 by default when no id is in the URL', async () => {
    renderAt('/arbol?estado=listo');
    expect(await screen.findByRole('treeitem', { name: /MRD-001/ })).toHaveProperty('ariaSelected', 'true');
  });

  it('shows the traceability panel for the id in the URL', async () => {
    renderAt('/arbol/PRD-004?estado=listo');
    expect(await screen.findByRole('heading', { level: 2, name: 'Explorador web del Feature Tree y del drift' })).toBeTruthy();
  });

  it('shows an ErrorState naming the unknown id, with a way back to /arbol', async () => {
    renderAt('/arbol/DOES-NOT-EXIST?estado=listo');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('No encontramos la feature DOES-NOT-EXIST en el árbol.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ir al árbol' })).toBeTruthy();
  });

  it('only has one h1 on the page: the PageHeader title', async () => {
    renderAt('/arbol?estado=listo');
    await screen.findByRole('treeitem', { name: /MRD-001/ });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('opens the closure modal from "Ver cierre de feature"', async () => {
    const user = userEvent.setup();
    renderAt('/arbol/FR-001?estado=listo');
    await screen.findByRole('heading', { level: 2, name: 'Persistencia stateful de borradores' });
    await user.click(screen.getByRole('button', { name: 'Ver cierre de feature' }));
    expect(screen.getByRole('dialog', { name: 'Cerrar feature' })).toBeTruthy();
    expect(screen.getByText('Cuatro de cinco checks pasan')).toBeTruthy();
  });

  it('shows the already-closed message for a closed feature', async () => {
    const user = userEvent.setup();
    renderAt('/arbol/PRD-002?estado=listo');
    await screen.findByRole('heading', { level: 2, name: 'Multi-Project Governance & Conversational Authoring' });
    await user.click(screen.getByRole('button', { name: 'Ver cierre de feature' }));
    expect(screen.getByText('Esta feature ya está cerrada.')).toBeTruthy();
  });
});
