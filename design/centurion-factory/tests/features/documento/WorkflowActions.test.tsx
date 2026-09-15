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

// The desktop header and the mobile action bar both render Guardar/WorkflowActions (hidden by
// CSS depending on viewport), so every query below takes the first (desktop) match on purpose.
function desktopButton(name: string): HTMLElement {
  return screen.getAllByRole('button', { name })[0] as HTMLElement;
}

function queryDesktopButton(name: string): HTMLElement | null {
  const matches = screen.queryAllByRole('button', { name });
  return matches[0] ?? null;
}

async function selectRole(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.selectOptions(screen.getByRole('combobox', { name: 'Ver como' }), label);
}

function statusText(): string {
  return screen.getByRole('status').textContent ?? '';
}

describe('WorkflowActions by role, on a draft document (FR-003)', () => {
  it('lets the default Admin role ask for review', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/FR-003');
    await screen.findByText(/Versión 3/);

    await user.click(desktopButton('Pedir revisión'));
    await screen.findByRole('status');
    expect(statusText()).toContain('Revisión pedida');
  });

  it('shows a muted read-only line for Viewer and Commenter, with no actions', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/FR-003');
    await screen.findByText(/Versión 3/);

    await selectRole(user, 'Viewer');
    expect(screen.getAllByText('Solo lectura para tu rol.').length).toBeGreaterThan(0);
    expect(queryDesktopButton('Pedir revisión')).toBeNull();

    await selectRole(user, 'Commenter');
    expect(screen.getAllByText('Solo lectura para tu rol.').length).toBeGreaterThan(0);
  });

  it('gives Developer no workflow actions and no read-only line', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/FR-003');
    await screen.findByText(/Versión 3/);

    await selectRole(user, 'Developer');
    expect(queryDesktopButton('Pedir revisión')).toBeNull();
    expect(screen.queryByText('Solo lectura para tu rol.')).toBeNull();
  });

  it('lets Editor ask for review too', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/FR-003');
    await screen.findByText(/Versión 3/);

    await selectRole(user, 'Editor');
    await user.click(desktopButton('Pedir revisión'));
    expect(statusText()).toContain('Revisión pedida');
  });
});

describe('WorkflowActions in_review, blocked by validation (FR-003 after review request)', () => {
  it('disables Publicar with a helper message and still allows Volver a borrador', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/FR-003');
    await screen.findByText(/Versión 3/);
    await user.click(desktopButton('Pedir revisión'));
    await screen.findByRole('status');

    const publish = desktopButton('Publicar');
    expect(publish.hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText('Resolvé los 2 errores de validación para publicar.').length).toBeGreaterThan(0);

    await user.click(desktopButton('Volver a borrador'));
    expect(statusText()).toContain('Vuelto a borrador');
  });
});

describe('WorkflowActions on a clean in_review document (SDD-011)', () => {
  it('publishes when there are no blocking errors', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const publish = desktopButton('Publicar');
    expect(publish.hasAttribute('disabled')).toBe(false);

    await user.click(publish);
    expect(statusText()).toContain('Documento publicado');
  });
});

describe('WorkflowActions published/archived cycle (SDD-001)', () => {
  it('archives and then restores to draft', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-001');
    await screen.findByText(/Versión 3/);

    await user.click(desktopButton('Archivar'));
    expect(statusText()).toContain('Documento archivado');

    await user.click(desktopButton('Restaurar como borrador'));
    expect(statusText()).toContain('Restaurado como borrador');
  });
});
