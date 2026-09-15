import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('DocumentosPage demo states', () => {
  it('shows a skeleton while cargando', () => {
    renderAt('/documentos?estado=cargando');
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('shows an empty state with a next action when vacio', async () => {
    const user = userEvent.setup();
    renderAt('/documentos?estado=vacio');
    expect(screen.getByText('No hay documentos todavía')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Nuevo documento' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows an error state with a retry action', () => {
    renderAt('/documentos?estado=error');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('renders the real table once listo', async () => {
    renderAt('/documentos');
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getByText('SDD-011')).toBeTruthy();
  });
});

describe('DocumentosPage filters, search and sort', () => {
  it('filters by kind, combined with search', async () => {
    const user = userEvent.setup();
    renderAt('/documentos');
    await screen.findByRole('table');

    await user.click(screen.getByRole('radio', { name: 'MRD' }));
    expect(screen.getByText('MRD-001')).toBeTruthy();
    expect(screen.queryByText('SDD-011')).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Todos' }));
    await user.type(screen.getByRole('searchbox', { name: 'Buscar por id o título' }), 'SDD-011');
    expect(screen.getByText('SDD-011')).toBeTruthy();
    expect(screen.queryByText('MRD-001')).toBeNull();
  });

  it('shows the empty-filter message and clears filters', async () => {
    const user = userEvent.setup();
    renderAt('/documentos');
    await screen.findByRole('table');

    await user.type(screen.getByRole('searchbox', { name: 'Buscar por id o título' }), 'no-existe-nada');
    expect(screen.getByText('Ningún documento coincide con estos filtros.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(screen.getByText('SDD-011')).toBeTruthy();
  });

  it('defaults to sorting Actualizado desc and toggles on click', async () => {
    const user = userEvent.setup();
    renderAt('/documentos');
    await screen.findByRole('table');

    const header = screen.getByRole('columnheader', { name: /Actualizado/ });
    expect(header.getAttribute('aria-sort')).toBe('descending');

    await user.click(within(header).getByRole('button', { name: /Actualizado/ }));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
  });

  it('honors ?q= to prefill the search field', async () => {
    renderAt('/documentos?q=SDD-011');
    await screen.findByRole('table');
    const search = screen.getByRole('searchbox', { name: 'Buscar por id o título' }) as HTMLInputElement;
    expect(search.value).toBe('SDD-011');
    expect(screen.queryByText('MRD-001')).toBeNull();
  });
});

describe('DocumentosPage "Nuevo documento" modal', () => {
  it('honors ?nuevo=1 by opening the modal', async () => {
    renderAt('/documentos?nuevo=1');
    await screen.findByRole('table');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('validates the title and creates a draft document on success', async () => {
    const user = userEvent.setup();
    renderAt('/documentos');
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Nuevo documento' }));
    await user.type(screen.getByLabelText('Título'), 'Corto');
    await user.click(screen.getByRole('button', { name: 'Crear' }));
    expect(screen.getByText('Escribí un título de al menos 8 caracteres.')).toBeTruthy();

    await user.type(screen.getByLabelText('Título'), ', ahora un poco más largo');
    await user.click(screen.getByRole('button', { name: 'Crear' }));

    expect((await screen.findByRole('status')).textContent).toContain('Documento creado');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/Corto, ahora un poco más largo/)).toBeTruthy();
  });
});
