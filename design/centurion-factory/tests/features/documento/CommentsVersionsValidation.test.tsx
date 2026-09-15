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

function firstButton(name: string): HTMLElement {
  return screen.getAllByRole('button', { name })[0] as HTMLElement;
}

async function openComentarios(user: ReturnType<typeof userEvent.setup>) {
  const tablist = screen.getByRole('tablist', { name: 'Panel del documento' });
  await user.click(within(tablist).getByRole('tab', { name: /Comentarios/ }));
}

async function openVersiones(user: ReturnType<typeof userEvent.setup>) {
  const tablist = screen.getByRole('tablist', { name: 'Panel del documento' });
  await user.click(within(tablist).getByRole('tab', { name: 'Versiones' }));
}

async function openValidacion(user: ReturnType<typeof userEvent.setup>) {
  const tablist = screen.getByRole('tablist', { name: 'Panel del documento' });
  await user.click(within(tablist).getByRole('tab', { name: 'Validación' }));
}

describe('CommentsTab on PRD-006 (open and resolved threads)', () => {
  it('shows only open threads by default and reveals resolved ones on toggle', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/PRD-006');
    await screen.findByText(/Versión 3/);
    await openComentarios(user);

    expect(screen.getAllByText(/la lámpara de parada de línea/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cianotipo/)).toBeNull();

    const [toggle] = screen.getAllByRole('checkbox', { name: 'Mostrar resueltos' });
    await user.click(toggle as HTMLElement);
    expect(screen.getAllByText(/Cianotipo/).length).toBeGreaterThan(0);
  });
});

describe('CommentsTab on SDD-011 (two open threads)', () => {
  it('replies to a thread and can resolve it', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);
    await openComentarios(user);

    const [replyInput] = screen.getAllByPlaceholderText('Responder…');
    await user.type(replyInput as HTMLElement, 'Sí, queda para FR-004.');
    await user.click(firstButton('Responder'));
    expect(screen.getAllByText('Sí, queda para FR-004.').length).toBeGreaterThan(0);

    await user.click(firstButton('Resolver'));
    expect(screen.queryByText('Sí, queda para FR-004.')).toBeNull();

    const [toggle] = screen.getAllByRole('checkbox', { name: 'Mostrar resueltos' });
    await user.click(toggle as HTMLElement);
    expect(screen.getAllByText(/Resuelto por Ana Ríos/).length).toBeGreaterThan(0);
  });
});

describe('VersionsTab on SDD-011 (starts at version 7)', () => {
  it('lists the history and restores an older version through the confirm modal', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);
    await openVersiones(user);

    expect(screen.getAllByText('Versión 5').length).toBeGreaterThan(0);

    const rows = screen.getAllByText('Versión 5');
    const row = rows[0]!.closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Restaurar' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Vas a restaurar la versión 5\. Se crea una versión nueva; no se pierde nada\./)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Restaurar' }));
    expect((await screen.findByRole('status')).textContent).toContain('Versión restaurada');
    expect(screen.getAllByText('Versión 8').length).toBeGreaterThan(0);
  });
});

describe('ValidationTab', () => {
  it('shows the blocking errors for FR-003', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/FR-003');
    await screen.findByText(/Versión 3/);
    await openValidacion(user);

    expect(screen.getAllByText('No tiene ningún blueprint que la diseñe todavía: no puede avanzar a Diseño sin uno.').length).toBeGreaterThan(0);
  });

  it('shows "Sin problemas de validación." for a clean document', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/MRD-001');
    await screen.findByText(/Versión 3/);
    await openValidacion(user);

    expect(screen.getAllByText('Sin problemas de validación.').length).toBeGreaterThan(0);
  });
});
