import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateDto, InboxItemDto, InboxResponseDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { ApiClientError } from '../../src/api/api-client-error.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { Entrada } from '../../src/routes/Entrada.js';
import { makeProjectShellContext } from './fixtures.js';

const ITEMS: InboxItemDto[] = [
  { id: 'FB-007', kind: 'FB', title: 'Ver drift por rama', body: 'Texto del feedback', status: 'new', source: 'slack', links: [], receivedAt: '2026-01-05T00:00:00.000Z' },
  { id: 'ART-002', kind: 'ART', title: 'Grabación de la daily', body: '', status: 'triaged', source: 'meeting', links: ['PRD-004'], receivedAt: '2026-01-02T00:00:00.000Z' },
];

const CANDIDATES: CandidateDto[] = [
  { featureId: 'FR-003', score: 0.92, reason: 'mention' },
  { featureId: 'PRD-004', score: 0.61, reason: 'score' },
];

function inbox(overrides: Partial<InboxResponseDto> = {}): InboxResponseDto {
  return { items: ITEMS, total: ITEMS.length, ...overrides };
}

/** A deterministic descending `receivedAt` series so the default order equals the original order. */
function manyItems(count: number): InboxItemDto[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `FB-${String(count - index).padStart(3, '0')}`;
    const day = String(count - index).padStart(2, '0');
    return {
      id,
      kind: 'FB',
      title: `Ítem ${id}`,
      body: '',
      status: 'new',
      source: 'slack',
      links: [],
      receivedAt: `2026-01-${day}T00:00:00.000Z`,
    };
  });
}

function renderPage(initialEntry = '/ctx') {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('owner', 'admin')} />, children: [{ index: true, element: <Entrada /> }] }],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function searchOf(router: ReturnType<typeof renderPage>): URLSearchParams {
  return new URLSearchParams(router.state.location.search);
}

describe('Entrada', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('lists every feedback and artifact item', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    renderPage();

    expect(await screen.findByText('FB-007')).toBeTruthy();
    expect(screen.getByText('ART-002')).toBeTruthy();
  });

  it('shows an empty state when the inbox is empty', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue({ items: [], total: 0 });
    renderPage();

    expect(await screen.findByText('Todavía no hay feedback ni artifacts para este proyecto')).toBeTruthy();
  });

  it('renders a «Recibido» column with the receivedAt date', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    renderPage();

    expect(await screen.findByRole('columnheader', { name: 'Recibido' })).toBeTruthy();
    expect(screen.getByText('05/01/2026')).toBeTruthy();
    expect(screen.getByText('02/01/2026')).toBeTruthy();
  });

  it('orders by fecha desc by default and wires the real aria-sort', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    renderPage();

    const table = await screen.findByRole('table', { name: 'Bandeja de entrada' });
    expect(within(table).getByRole('columnheader', { name: 'Recibido' }).getAttribute('aria-sort')).toBe('descending');

    const rows = within(table).getAllByRole('row');
    // Header row first, then the newest item (FB-007, 05/01) before the older one (ART-002, 02/01) — id order would be the reverse.
    expect(rows[1]?.textContent).toContain('FB-007');
    expect(rows[2]?.textContent).toContain('ART-002');
  });

  it('filters by estado chip and by tipo select', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    renderPage();
    await screen.findByText('FB-007');

    await userEvent.click(screen.getByRole('radio', { name: /Triados/ }));
    expect(screen.getByText('ART-002')).toBeTruthy();
    expect(screen.queryByText('FB-007')).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: /Todos/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'FB');
    expect(screen.getByText('FB-007')).toBeTruthy();
    expect(screen.queryByText('ART-002')).toBeNull();
  });

  it('filters by fuente and writes it to the URL', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    const router = renderPage();
    await screen.findByText('FB-007');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Fuente' }), 'meeting');

    expect(screen.getByText('ART-002')).toBeTruthy();
    expect(screen.queryByText('FB-007')).toBeNull();
    expect(searchOf(router).get('fuente')).toBe('meeting');
  });

  it('searches id, título and body, accent-insensitively, and writes q to the URL', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    const router = renderPage();
    await screen.findByText('FB-007');

    fireEvent.change(screen.getByLabelText('Buscar en la bandeja'), { target: { value: 'grabacion' } });

    await waitFor(() => expect(screen.queryByText('FB-007')).toBeNull());
    expect(screen.getByText('ART-002')).toBeTruthy();
    expect(searchOf(router).get('q')).toBe('grabacion');
  });

  it('reads the initial filtros from the URL', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    renderPage('/ctx?tipo=FB&estado=new');

    expect(await screen.findByText('FB-007')).toBeTruthy();
    expect(screen.queryByText('ART-002')).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Tipo' }) as HTMLSelectElement).value).toBe('FB');
  });

  it('paginates at 25 rows per page, resetting to page 1 on a filter change', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue({ items: manyItems(26), total: 26 });
    const router = renderPage();

    const table = await screen.findByRole('table', { name: 'Bandeja de entrada' });
    expect(within(table).getAllByRole('row')).toHaveLength(26); // header + 25
    expect(screen.getByText('Página 1 de 2')).toBeTruthy();
    expect(screen.getByText('1–25 de 26')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));

    expect(screen.getByText('Página 2 de 2')).toBeTruthy();
    expect(searchOf(router).get('pagina')).toBe('2');
    const pageTwo = screen.getByRole('table', { name: 'Bandeja de entrada' });
    expect(within(pageTwo).getAllByRole('row')).toHaveLength(2); // header + 1

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'FB');
    expect(screen.getByText('Página 1 de 2')).toBeTruthy();
    expect(searchOf(router).get('pagina')).toBeNull();
  });

  it('folds agent:* items into a collapsible «Automáticos» block', async () => {
    const withAutomatic: InboxItemDto[] = [
      ...ITEMS,
      { id: 'FB-099', kind: 'FB', title: 'Reporte automático', body: '', status: 'triaged', source: 'agent:claude', links: [], receivedAt: '2026-01-01T00:00:00.000Z' },
    ];
    vi.spyOn(client, 'listInbox').mockResolvedValue({ items: withAutomatic, total: withAutomatic.length });
    renderPage();

    await screen.findByText('FB-007');
    const toggle = screen.getByRole('button', { name: 'Automáticos (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('FB-099')).toBeNull();

    await userEvent.click(toggle);
    expect(await screen.findByText('FB-099')).toBeTruthy();
  });

  it('links a feedback item to the best-matching candidate', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    vi.spyOn(client, 'getFeedbackCandidates').mockResolvedValue(CANDIDATES);
    const triage = vi.spyOn(client, 'triageFeedback').mockResolvedValue({ linkedTo: ['FR-003'] });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Enlazar a feature' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enlazar a feature' });
    expect(within(dialog).getByText('FR-003')).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Enlazar' }));

    await waitFor(() => expect(triage).toHaveBeenCalledWith('acme', 'web', 'FB-007', { informs: ['FR-003'] }));
    expect(await screen.findByText('Feedback enlazado a FR-003')).toBeTruthy();
  });

  it('explains a 409 pending_republish instead of a generic error', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    vi.spyOn(client, 'getFeedbackCandidates').mockResolvedValue(CANDIDATES);
    vi.spyOn(client, 'triageFeedback').mockRejectedValue(new ApiClientError(409, 'unknown', 'pending republish'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Enlazar a feature' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enlazar a feature' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enlazar' }));

    expect(await screen.findByText(/se va a aplicar recién cuando se republique el documento/)).toBeTruthy();
  });

  it('registers new feedback', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    const submit = vi.spyOn(client, 'submitFeedback').mockResolvedValue({ id: 'FB-010', linkedTo: [], candidates: [] });
    renderPage();
    await screen.findByText('FB-007');

    await userEvent.click(screen.getByRole('button', { name: 'Registrar feedback' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar feedback' });
    await userEvent.type(within(dialog).getByLabelText('Fuente'), 'email');
    await userEvent.type(within(dialog).getByLabelText('Texto'), 'El importador tarda mucho');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar feedback' }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('acme', 'web', { text: 'El importador tarda mucho', source: 'email', title: undefined, customer: undefined }),
    );
    expect(await screen.findByText('Feedback registrado')).toBeTruthy();
  });

  it('surfaces a load error', async () => {
    vi.spyOn(client, 'listInbox').mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
