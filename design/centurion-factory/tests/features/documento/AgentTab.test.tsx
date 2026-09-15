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

// The agent tab renders once in the desktop panel and once in the mobile tab bar.
function firstButton(name: string): HTMLElement {
  return screen.getAllByRole('button', { name })[0] as HTMLElement;
}

describe('AgentTab on SDD-011 (a pending proposal)', () => {
  it('shows the diff and accepting it updates the block, the gutter and the version', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    expect(screen.getAllByText('Agregar la tarea de capturas a 375 px').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Revisión visual manual en mobile/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Capturas de cada vista a 375 px/).length).toBeGreaterThan(0);

    await user.click(firstButton('Aceptar'));

    expect((await screen.findByRole('status')).textContent).toContain('Propuesta aceptada');
    expect(screen.getAllByText('Aceptada · Agente (aceptado por Ana Ríos)').length).toBeGreaterThan(0);
    expect(screen.getByText(/Versión 8/)).toBeTruthy();

    const agentMarks = screen.getAllByText('Agente', { selector: '[aria-label]' });
    expect(agentMarks.some((mark) => mark.getAttribute('aria-label') === 'Agente (aceptado por Ana Ríos)')).toBe(true);
  });

  it('rejecting shows the rejected confirmation and leaves the document unchanged', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    await user.click(firstButton('Rechazar'));
    expect(screen.getAllByText('Rechazada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('El documento no cambió. Pedí otra propuesta si la necesitás.').length).toBeGreaterThan(0);
    expect(screen.getByText(/Versión 7/)).toBeTruthy();
  });

  it('sends a request to the agent', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const [textarea] = screen.getAllByPlaceholderText(/Describí qué debe cambiar en SDD-011/);
    await user.type(textarea as HTMLElement, 'Agregá una sección de riesgos de accesibilidad.');
    await user.click(firstButton('Enviar pedido'));

    expect((await screen.findByRole('status')).textContent).toContain('Pedido enviado al agente');
  });
});

describe('AgentTab on SDD-012 (a stale proposal)', () => {
  it('disables Aceptar and shows the stale warning', async () => {
    renderAt('/documentos/SDD-012');
    await screen.findByText(/Versión 3/);

    expect(screen.getAllByText('Esta propuesta quedó vieja: el texto cambió desde que el agente la escribió.').length).toBeGreaterThan(0);
    const accept = firstButton('Aceptar');
    expect(accept.hasAttribute('disabled')).toBe(true);
  });
});

describe('AgentTab with no proposal', () => {
  it('shows a placeholder message', async () => {
    renderAt('/documentos/MRD-001');
    await screen.findByText(/Versión 3/);
    expect(screen.getAllByText('Sin propuestas del agente para este documento.').length).toBeGreaterThan(0);
  });
});
