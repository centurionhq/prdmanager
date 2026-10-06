import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('EntradaPage', () => {
  it('shows a skeleton while loading', () => {
    renderAt('/entrada?estado=cargando');
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('shows an error state with a retry action', () => {
    renderAt('/entrada?estado=error');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows the empty state when the demo forces it', () => {
    renderAt('/entrada?estado=vacio');
    expect(screen.getByText('Todavía no hay feedback ni artifacts')).toBeTruthy();
  });

  it('shows the Sin triar tab by default with the computed count and the aside', async () => {
    renderAt('/entrada?estado=listo');
    const tab = await screen.findByRole('tab', { name: /Sin triar/ });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('FB-007')).toBeTruthy();
    expect(screen.getByText('FB-009')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Cómo llega lo nuevo' })).toBeTruthy();
    expect(screen.getByText('submit_feedback')).toBeTruthy();
  });

  it('hides the decorative "·" separators between the source and the relative date (WO-317)', async () => {
    renderAt('/entrada?estado=listo');
    const row = (await screen.findByText('FB-007')).closest('div');
    if (!row) throw new Error('row not found');
    const dot = within(row).getByText('·');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the andon "Lleva N días sin triar" line for overdue feedback', async () => {
    renderAt('/entrada?estado=listo');
    await screen.findByText('FB-007');
    expect(screen.getByText(/Lleva 3 días sin triar/)).toBeTruthy();
  });

  it('expanding an item shows its quoted body and ranked candidates', async () => {
    const user = userEvent.setup();
    renderAt('/entrada?estado=listo');
    await screen.findByText('FB-007');
    await user.click(screen.getByRole('button', { name: /Los developers quieren ver el drift/ }));
    expect(screen.getByText(/en la daily de plataforma pidieron/)).toBeTruthy();
    expect(screen.getByText('Candidatas')).toBeTruthy();
    expect(screen.getByText(/Mejor coincidencia/)).toBeTruthy();
  });

  it('switches to the Triados tab and shows already-triaged feedback with what it informs', async () => {
    const user = userEvent.setup();
    renderAt('/entrada?estado=listo');
    await screen.findByText('FB-007');
    await user.click(screen.getByRole('tab', { name: 'Triados' }));
    const panel = screen.getByRole('tabpanel', { name: 'Triados' });
    const row = within(panel).getByText('FB-006').closest('.row');
    if (!row) throw new Error('row not found');
    expect(within(row as HTMLElement).getByText(/Informa a/).textContent).toContain('PRD-006');
  });

  it('switches to the Artifacts tab and shows artifact items', async () => {
    const user = userEvent.setup();
    renderAt('/entrada?estado=listo');
    await screen.findByText('FB-007');
    await user.click(screen.getByRole('tab', { name: 'Artifacts' }));
    const panel = screen.getByRole('tabpanel', { name: 'Artifacts' });
    expect(within(panel).getByText('ART-001')).toBeTruthy();
    expect(within(panel).getByText('ART-005')).toBeTruthy();
  });

  it('pads the row actions to a 44px mobile hit target (WO-298)', async () => {
    renderAt('/entrada?estado=listo');
    await screen.findByText('FB-007');
    const [link] = screen.getAllByRole('button', { name: 'Enlazar a feature' });
    expect(link?.className).toContain('actionButton');
  });

  it('"Enlazar a feature" preselects the best match and moves the item to Triados on confirm', async () => {
    const user = userEvent.setup();
    renderAt('/entrada?estado=listo');
    const row = (await screen.findByText('FB-007')).closest('div');
    if (!row) throw new Error('row not found');
    await user.click(within(row.parentElement as HTMLElement).getByRole('button', { name: 'Enlazar a feature' }));

    const dialog = screen.getByRole('dialog', { name: 'Enlazar a feature' });
    const bestOption = within(dialog).getByRole('radio', { name: /FR-003/ });
    expect(bestOption).toHaveProperty('checked', true);

    await user.click(within(dialog).getByRole('button', { name: 'Enlazar' }));
    expect((await screen.findByRole('status')).textContent).toContain('Feedback enlazado a FR-003');

    await user.click(screen.getByRole('tab', { name: 'Triados' }));
    const panel = screen.getByRole('tabpanel', { name: 'Triados' });
    const linkedRow = within(panel).getByText('FB-007').closest('.row');
    if (!linkedRow) throw new Error('linked row not found');
    expect(within(linkedRow as HTMLElement).getByText(/Informa a/).textContent).toContain('FR-003');
  });

  it('"Crear feature request" prefills the title and creates the next FR id', async () => {
    const user = userEvent.setup();
    renderAt('/entrada?estado=listo');
    const row = (await screen.findByText('FB-008')).closest('div');
    if (!row) throw new Error('row not found');
    await user.click(within(row.parentElement as HTMLElement).getByRole('button', { name: 'Crear feature request' }));

    const dialog = screen.getByRole('dialog', { name: 'Crear feature request' });
    const titleInput = within(dialog).getByRole('textbox', { name: 'Título' });
    expect(titleInput).toHaveProperty('value', 'El importador tarda 9 minutos en repos grandes');

    await user.click(within(dialog).getByRole('button', { name: 'Crear feature request' }));
    expect((await screen.findByRole('status')).textContent).toContain('Feature request FR-006 creada');
  });

  it('"Registrar feedback" adds a new FB item and shows it in Sin triar', async () => {
    const user = userEvent.setup();
    renderAt('/entrada?estado=listo');
    await screen.findByText('FB-007');
    await user.click(screen.getByRole('button', { name: 'Registrar feedback' }));

    const dialog = screen.getByRole('dialog', { name: 'Registrar feedback' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Título' }), 'Nuevo pedido de un cliente');
    await user.type(within(dialog).getByRole('textbox', { name: 'Texto' }), 'Detalle del pedido.');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar feedback' }));

    expect((await screen.findByRole('status')).textContent).toContain('Feedback registrado');
    expect(screen.getByText('Nuevo pedido de un cliente')).toBeTruthy();
  });
});

describe('frozen demo «ahora» (WO-674)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-06-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the andon and the relative badge of FB-007 as the artboard, years after the demo date', async () => {
    renderAt('/entrada?estado=listo');
    const id = await screen.findByText('FB-007');
    const row = id.closest('div');
    if (!row) throw new Error('row not found');
    expect(within(row).getByText(/Lleva 3 días sin triar/)).toBeTruthy();
    expect(within(row).getByText('hace 3 d')).toBeTruthy();
  });
});
