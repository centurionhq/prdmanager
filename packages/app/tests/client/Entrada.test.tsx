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

    await userEvent.click(await screen.findByRole('button', { name: 'Enlazar FB-007 a una feature' }));
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

    await userEvent.click(await screen.findByRole('button', { name: 'Enlazar FB-007 a una feature' }));
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

  describe('triage', () => {
    function rowOf(id: string): HTMLElement {
      const row = screen.getByText(id).closest('tr');
      if (row === null) throw new Error(`row ${id} not found`);
      return row;
    }

    it('dismisses one row without a reason', async () => {
      vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
      const dismiss = vi.spyOn(client, 'dismissFeedback').mockResolvedValue({ id: 'FB-007', status: 'dismissed', reason: null, applied: 'immediate' });
      renderPage();
      await screen.findByText('FB-007');

      await userEvent.click(within(rowOf('FB-007')).getByRole('button', { name: 'Descartar FB-007' }));
      const dialog = await screen.findByRole('dialog', { name: 'Descartar ítem' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));

      await waitFor(() => expect(dismiss).toHaveBeenCalledWith('acme', 'web', 'FB-007', { reason: undefined }));
      expect(await screen.findByText('FB-007 descartado')).toBeTruthy();
    });

    it('sends the optional dismiss reason', async () => {
      vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
      const dismiss = vi.spyOn(client, 'dismissFeedback').mockResolvedValue({ id: 'FB-007', status: 'dismissed', reason: 'x', applied: 'immediate' });
      renderPage();
      await screen.findByText('FB-007');

      await userEvent.click(within(rowOf('FB-007')).getByRole('button', { name: 'Descartar FB-007' }));
      const dialog = await screen.findByRole('dialog', { name: 'Descartar ítem' });
      await userEvent.type(within(dialog).getByLabelText('Motivo (opcional)'), 'ya lo cubre otra feature');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));

      await waitFor(() => expect(dismiss).toHaveBeenCalledWith('acme', 'web', 'FB-007', { reason: 'ya lo cubre otra feature' }));
    });

    it('keeps the modal open and explains a 409 on dismiss', async () => {
      vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
      vi.spyOn(client, 'dismissFeedback').mockRejectedValue(new ApiClientError(409, 'unknown', 'pending republish'));
      renderPage();
      await screen.findByText('FB-007');

      await userEvent.click(within(rowOf('FB-007')).getByRole('button', { name: 'Descartar FB-007' }));
      const dialog = await screen.findByRole('dialog', { name: 'Descartar ítem' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));

      expect(await within(dialog).findByText(/el descarte se va a aplicar recién cuando se republique el documento/)).toBeTruthy();
    });

    it('marks a row as duplicate of another id', async () => {
      vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
      const mark = vi.spyOn(client, 'markDuplicate').mockResolvedValue({ id: 'FB-007', status: 'duplicate', duplicateOf: 'FB-001', applied: 'immediate' });
      renderPage();
      await screen.findByText('FB-007');

      await userEvent.click(within(rowOf('FB-007')).getByRole('button', { name: 'Marcar duplicado FB-007' }));
      const dialog = await screen.findByRole('dialog', { name: 'Marcar duplicado' });
      await userEvent.type(within(dialog).getByLabelText('Id del duplicado'), 'FB-001');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar duplicado' }));

      await waitFor(() => expect(mark).toHaveBeenCalledWith('acme', 'web', 'FB-007', { duplicateOf: 'FB-001' }));
      expect(await screen.findByText(/FB-001/, { selector: '[role="status"], [role="status"] *' })).toBeTruthy();
    });

    it('rejects a malformed duplicate id without calling the API', async () => {
      vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
      const mark = vi.spyOn(client, 'markDuplicate');
      renderPage();
      await screen.findByText('FB-007');

      await userEvent.click(within(rowOf('FB-007')).getByRole('button', { name: 'Marcar duplicado FB-007' }));
      const dialog = await screen.findByRole('dialog', { name: 'Marcar duplicado' });
      await userEvent.type(within(dialog).getByLabelText('Id del duplicado'), 'nope');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar duplicado' }));

      expect(await within(dialog).findByText('Ingresá el id del duplicado (por ejemplo FB-018).')).toBeTruthy();
      expect(mark).not.toHaveBeenCalled();
    });

    it('opens the detail drawer with the rendered body', async () => {
      const item: InboxItemDto = { ...ITEMS[0]!, body: '## Detalle\n\nCuerpo del feedback' };
      vi.spyOn(client, 'listInbox').mockResolvedValue({ items: [item], total: 1 });
      renderPage();

      await userEvent.click(await screen.findByText('Ver drift por rama'));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Detalle')).toBeTruthy();
      expect(within(dialog).getByText('Cuerpo del feedback')).toBeTruthy();
    });

    it('shows the batch bar with the selection count', async () => {
      vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
      renderPage();
      await screen.findByText('FB-007');

      await userEvent.click(within(rowOf('FB-007')).getByRole('checkbox'));
      await userEvent.click(within(rowOf('ART-002')).getByRole('checkbox'));

      expect(screen.getByText('2 seleccionados')).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));
      expect(screen.queryByText('2 seleccionados')).toBeNull();
    });

    it('reports per-item failures of a partial batch', async () => {
      vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
      const batch = vi.spyOn(client, 'triageBatch').mockResolvedValue({
        action: 'dismiss',
        results: [
          { id: 'FB-007', ok: true },
          { id: 'ART-002', ok: false, error: 'pending_republish' },
        ],
        ok: 1,
        failed: 1,
      });
      renderPage();
      await screen.findByText('FB-007');

      await userEvent.click(within(rowOf('FB-007')).getByRole('checkbox'));
      await userEvent.click(within(rowOf('ART-002')).getByRole('checkbox'));
      await userEvent.click(screen.getByRole('button', { name: 'Descartar seleccionados' }));
      const dialog = await screen.findByRole('dialog', { name: 'Descartar ítem' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));

      await waitFor(() => expect(batch).toHaveBeenCalledWith('acme', 'web', { action: 'dismiss', ids: ['ART-002', 'FB-007'].sort(), reason: undefined }));
      expect(await screen.findByText(/ART-002 \(pending_republish\)/)).toBeTruthy();
      expect(screen.queryByText(/seleccionados$/)).toBeNull();
    });

    it('filters to dismissed items with the «Descartados» chip', async () => {
      const dismissed: InboxItemDto = { ...ITEMS[0]!, id: 'FB-020', title: 'Ya descartado', status: 'dismissed' };
      vi.spyOn(client, 'listInbox').mockResolvedValue({ items: [...ITEMS, dismissed], total: 3 });
      renderPage();
      await screen.findByText('FB-020');

      await userEvent.click(screen.getByRole('radio', { name: /Descartados/ }));

      expect(screen.getByText('FB-020')).toBeTruthy();
      expect(screen.queryByText('FB-007')).toBeNull();
      expect(within(rowOf('FB-020')).queryByRole('button', { name: 'Descartar FB-020' })).toBeNull();
    });

    it('reads a closed item as «Cerrado» and counts it once in the «Cerrados» chip (SDD-092 D7)', async () => {
      const closed: InboxItemDto = { ...ITEMS[0]!, id: 'FB-030', title: 'Ya cerrado', status: 'closed' };
      const dismissed: InboxItemDto = { ...ITEMS[0]!, id: 'FB-031', title: 'Descartado aparte', status: 'dismissed' };
      vi.spyOn(client, 'listInbox').mockResolvedValue({ items: [...ITEMS, closed, dismissed], total: 4 });
      renderPage();
      await screen.findByText('FB-030');

      const row = rowOf('FB-030');
      expect(within(row).getByText('Cerrado')).toBeTruthy();
      expect(within(row).queryByText('closed')).toBeNull();

      // The chip counts the only closed item: the dismissed one beside it does not leak into the count.
      const cerrados = screen.getByRole('radio', { name: /Cerrados/ });
      expect(cerrados.textContent).toBe('Cerrados1');
      expect(screen.getByRole('radio', { name: /Descartados/ }).textContent).toBe('Descartados1');

      await userEvent.click(cerrados);

      expect(screen.getByText('FB-030')).toBeTruthy();
      expect(screen.queryByText('FB-007')).toBeNull();
      expect(screen.queryByText('FB-031')).toBeNull();
    });
  });

  describe('contrato de nombres accesibles (WO-622)', () => {
    beforeEach(() => {
      vi.spyOn(client, 'listInbox').mockResolvedValue(inbox());
    });

    it('names every row control with its item id', async () => {
      renderPage();
      await screen.findByText('FB-007');

      expect(screen.getByRole('checkbox', { name: 'Seleccionar FB-007' })).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: 'Seleccionar ART-002' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Enlazar FB-007 a una feature' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Descartar FB-007' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Marcar duplicado FB-007' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Descartar ART-002' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Marcar duplicado ART-002' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Enlazar ART-002 a una feature' })).toBeNull();
    });

    it('keeps the accessible names unique (no generic row control)', async () => {
      renderPage();
      await screen.findByText('FB-007');

      expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Marcar duplicado' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Enlazar a feature' })).toBeNull();
    });

    it('identifies the Tipo select with id and name', async () => {
      renderPage();
      await screen.findByText('FB-007');

      const select = screen.getByRole('combobox', { name: 'Tipo' }) as HTMLSelectElement;
      expect(select.id).toBe('entrada-tipo');
      expect(select.getAttribute('name')).toBe('tipo');
    });

    it('announces the batch summary in an aria-live region', async () => {
      renderPage();
      await screen.findByText('FB-007');

      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar FB-007' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar ART-002' }));

      const live = screen.getByText('2 ítems seleccionados');
      expect(live.getAttribute('role')).toBe('status');
      expect(live.getAttribute('aria-live')).toBe('polite');

      await userEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));
      expect(screen.queryByText('2 ítems seleccionados')).toBeNull();
    });

    it('flips aria-sort with the real sort wiring', async () => {
      renderPage();
      await screen.findByText('FB-007');

      const table = screen.getByRole('table', { name: 'Bandeja de entrada' });
      const header = () => within(table).getByRole('columnheader', { name: 'Recibido' });
      expect(header().getAttribute('aria-sort')).toBe('descending');

      await userEvent.click(within(header()).getByRole('button', { name: 'Recibido' }));
      expect(header().getAttribute('aria-sort')).toBe('ascending');

      await userEvent.click(within(header()).getByRole('button', { name: 'Recibido' }));
      expect(header().getAttribute('aria-sort')).toBe('descending');
    });
  });

  it('surfaces a load error', async () => {
    vi.spyOn(client, 'listInbox').mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
