import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';
import { mockMatchMedia, restoreMatchMedia } from './matchMedia';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(restoreMatchMedia);

describe('DocumentoPage', () => {
  it('shows an error state with a link back to Documentos for an unknown id', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/XYZ-999');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getAllByText('No encontramos el documento XYZ-999.').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1, name: 'No encontramos el documento XYZ-999.' })).toBeTruthy();

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

describe('DocumentoPage: a single editor layout, chosen by viewport', () => {
  it('renders only the desktop layout by default (jsdom has no matchMedia)', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    expect(screen.getAllByRole('tablist', { name: 'Modo del editor' })).toHaveLength(1);
    expect(screen.queryByRole('tablist', { name: 'Secciones del documento' })).toBeNull();
    expect(screen.getByText('Frontmatter')).toBeTruthy();
  });

  it('renders only the mobile tabs when the viewport matches the mobile media query', async () => {
    mockMatchMedia(true);
    renderAt('/documentos/SDD-011');
    await screen.findByRole('tablist', { name: 'Secciones del documento' });

    expect(screen.getAllByRole('tablist', { name: 'Modo del editor' })).toHaveLength(1);
    expect(screen.queryByText('Frontmatter')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Panel del documento' })).toBeNull();
  });
});

describe('DocumentoPage: navigating between documents resets state', () => {
  it('does not keep the previous document\'s frontmatter title after navigating to another one', async () => {
    const user = userEvent.setup();
    const router = renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const titleInput = screen.getByLabelText('Título') as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Un título editado que no debería sobrevivir');

    await act(async () => {
      await router.navigate('/documentos/MRD-001');
    });
    await screen.findByText(/Versión 3/);

    const freshTitleInput = screen.getByLabelText('Título') as HTMLInputElement;
    expect(freshTitleInput.value).not.toBe('Un título editado que no debería sobrevivir');
  });
});
