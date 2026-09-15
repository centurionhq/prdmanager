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

describe('DocumentoPage', () => {
  it('shows an error state with a link back to Documentos for an unknown id', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/XYZ-999');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('No encontramos el documento XYZ-999.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Volver a Documentos' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Documentos' })).toBeTruthy();
  });

  it('saves: shows the Guardado toast and adds a new version', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');

    expect(await screen.findByText(/Versión 7/)).toBeTruthy();

    const [saveButton] = screen.getAllByRole('button', { name: 'Guardar' });
    await user.click(saveButton as HTMLElement);

    expect((await screen.findByRole('status')).textContent).toContain('Guardado');
    expect(screen.getByText(/Versión 8/)).toBeTruthy();
    expect(screen.getAllByText(/Guardado por Ana Ríos ahora/).length).toBeGreaterThan(0);
  });

  it('moves through the side panel tabs with arrow keys', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const tablist = screen.getByRole('tablist', { name: 'Panel del documento' });
    const agenteTab = within(tablist).getByRole('tab', { name: 'Agente' });
    agenteTab.focus();
    expect(agenteTab.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{ArrowRight}');
    const comentariosTab = within(tablist).getByRole('tab', { name: /Comentarios/ });
    expect(comentariosTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(comentariosTab);

    await user.keyboard('{ArrowLeft}');
    expect(agenteTab.getAttribute('aria-selected')).toBe('true');
  });
});
