import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('DriftPage issues (WO-294)', () => {
  it('groups issues by kind with a Spanish label and a count', async () => {
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/drift'] })} />);
    await screen.findByText('Código fuera de sincronía');
    const groupHeaders = Array.from(document.querySelectorAll('.groupHeader')).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(groupHeaders).toContain('Código fuera de sincronía 3');
    expect(groupHeaders).toContain('Órdenes fuera de sincronía 1');
    expect(groupHeaders).toContain('Ciclo de vida 2');
    expect(groupHeaders).toContain('Avisos de impacts_paths 1');
    expect(groupHeaders).toContain('Esperando reporte de CI 1');
  });

  it('shows the small action for each kind of issue', async () => {
    renderAt('/drift');
    await screen.findByText('Código fuera de sincronía');
    expect(screen.getAllByRole('link', { name: 'Ver blueprint' }).length).toBeGreaterThan(0);
    const openOrderLinks = screen.getAllByRole('link', { name: 'Abrir orden' }).map((link) => link.getAttribute('href'));
    expect(openOrderLinks).toContain('/ordenes?orden=WO-310');
    expect(screen.getAllByRole('link', { name: 'Triar feedback' }).length).toBeGreaterThan(0);
  });

  it('filters issues to a feature and shows a removable chip', async () => {
    const router = renderAt('/drift?feature=FR-002');
    await screen.findByText('Código fuera de sincronía');
    expect(screen.getByRole('button', { name: /Feature FR-002/ })).toBeTruthy();
    expect(screen.queryByText('Ciclo de vida')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Feature FR-002/ }));
    expect(router.state.location.search).toBe('');
  });

  it('runs the acknowledge flow: opens, closes on Esc, confirms and clears issues', async () => {
    const user = userEvent.setup();
    renderAt('/drift');
    await screen.findByText('Código fuera de sincronía');

    await user.click(screen.getByRole('button', { name: 'Reconocer drift' }));
    const dialog = screen.getByRole('dialog', { name: 'Reconocer drift' });
    expect(document.activeElement).toBe(dialog);

    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reconocer drift' }));
    const reopened = screen.getByRole('dialog', { name: 'Reconocer drift' });
    expect(within(reopened).getByText(/La línea base de SDD-012 avanza al commit/)).toBeTruthy();
    expect(within(reopened).getByText(/Queda registrado a nombre de Ana Ríos/)).toBeTruthy();

    await user.click(within(reopened).getByRole('button', { name: 'Reconocer drift' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Drift reconocido');
    expect(screen.queryByText(/packages\/server\/src\/import\/scan\.ts/)).toBeNull();
    expect(screen.queryByText(/dejó/)).toBeNull();
  });

  it('shows the CI error state', () => {
    renderAt('/drift?estado=error');
    expect(screen.getByText('No pudimos leer el reporte de CI de feat/fr-002-importer.')).toBeTruthy();
    expect(screen.getByText('Reintentá o revisá que el token prdm_ci_… siga vigente.')).toBeTruthy();
  });
});
