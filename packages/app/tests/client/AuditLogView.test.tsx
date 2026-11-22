/**
 * WO-582 (SDD-056/PRD-036 R2): the audit body the project's and the organisation's screens share. The screens'
 * own tests keep covering what each one reads; these cover what only the shared body can get wrong.
 *
 * WO-705 (SDD-091 D5): the four filters — action, date range, person — live in the URL, the action list comes
 * from the scope's facets, and the total of the cut sits next to «Cargar más».
 */
import { useState, type ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { AuditFacetsDto, AuditLogEntryDto } from '@prdm/contracts';
import { AuditLogView, type AuditLogPageResult } from '../../src/routes/audit/AuditLogView.js';
import type { AuditLogParams } from '../../src/api/audit.js';

function entry(id: string, action: string): AuditLogEntryDto {
  return { id, createdAt: '2026-09-20T10:00:00.000Z', actor: { type: 'user', id: 'u1' }, action, target: 'WO-001', metadata: {} } as AuditLogEntryDto;
}

const FACETS: AuditFacetsDto = {
  actions: [
    { action: 'document.published', count: 12 },
    { action: 'drift.acknowledged', count: 3 },
  ],
  actors: [
    { type: 'user', id: 'u1', name: 'Ana Ríos', count: 9 },
    { type: 'agent', id: 'claude', name: null, count: 6 },
  ],
  total: 15,
};

/** What the body asks for when nothing is filtered: the object still names the four filters, empty. */
const NO_FILTER: AuditLogParams = { action: undefined, from: undefined, to: undefined, actorType: undefined, actorId: undefined };

type Load = (params: AuditLogParams) => Promise<AuditLogPageResult>;

function loadOf(...pages: AuditLogPageResult[]): Mock<Load> {
  const fn = vi.fn<Load>().mockResolvedValue({ items: [], nextCursor: null });
  for (const page of pages) fn.mockResolvedValueOnce(page);
  return fn;
}

function renderView(
  load: Load,
  { loadFacets = () => Promise.resolve(FACETS), scopeKey = 'acme/web', initialEntry = '/auditoria' } = {},
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [{ path: '/auditoria', element: <AuditLogView scopeKey={scopeKey} load={load} loadFacets={loadFacets} /> }],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function dateField(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

/** The total is one sentence split over `.num` spans (tabular figures, the repo's convention): match the
 * paragraph's whole text instead of a single text node. */
function lineText(text: string) {
  return (_: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text;
}

describe('AuditLogView (WO-582, SDD-056)', () => {
  it('reads the first page with no filter and draws it', async () => {
    const load = loadOf({ items: [entry('a', 'document.published')], nextCursor: null });
    renderView(load);

    expect(await screen.findByText('document.published')).toBeTruthy();
    expect(load).toHaveBeenCalledWith(NO_FILTER);
  });

  it('filters by the exact action typed, and offers to take the filter off once it is on', async () => {
    const load = loadOf({ items: [entry('a', 'document.published')], nextCursor: null });
    renderView(load);
    await screen.findByText('document.published');
    expect(screen.queryByRole('button', { name: 'Quitar filtros' })).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Acción'), 'otra');
    await userEvent.type(screen.getByLabelText('Filtrar por acción'), 'drift.acknowledged');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ ...NO_FILTER, action: 'drift.acknowledged' }));
    expect(await screen.findByRole('button', { name: 'Quitar filtros' })).toBeTruthy();
  });

  it('taking the filters off reads the unfiltered log again and empties the fields', async () => {
    const load = loadOf({ items: [entry('a', 'x.y')], nextCursor: null });
    renderView(load, { initialEntry: '/auditoria?accion=x.y&desde=2026-03-01' });
    await screen.findByText('x.y');

    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));

    await waitFor(() => expect(load).toHaveBeenLastCalledWith(NO_FILTER));
    expect(screen.getByLabelText('Acción')).toHaveProperty('value', '');
    expect(dateField('Desde').value).toBe('');
  });

  it('a filter is trimmed: a stray space is not part of the action', async () => {
    const load = loadOf({ items: [entry('a', 'x.y')], nextCursor: null });
    renderView(load);
    await screen.findByText('x.y');

    await userEvent.selectOptions(screen.getByLabelText('Acción'), 'otra');
    await userEvent.type(screen.getByLabelText('Filtrar por acción'), '  x.y  ');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ ...NO_FILTER, action: 'x.y' }));
  });

  it('pages with the cursor it was given and appends, never replacing what is on screen', async () => {
    const load = loadOf({ items: [entry('a', 'first.page')], nextCursor: 'c1' }, { items: [entry('b', 'second.page')], nextCursor: null });
    renderView(load);
    await screen.findByText('first.page');

    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));

    expect(await screen.findByText('second.page')).toBeTruthy();
    expect(screen.getByText('first.page')).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith({ ...NO_FILTER, cursor: 'c1' });
  });

  it('showing another log starts clean: the previous filter does not follow it', async () => {
    const load = loadOf({ items: [entry('a', 'x.y')], nextCursor: null });

    function Harness(): ReactElement {
      const [scopeKey, setScopeKey] = useState('acme/web');
      return (
        <>
          <button type="button" onClick={() => setScopeKey('acme/api')}>
            otro log
          </button>
          <AuditLogView scopeKey={scopeKey} load={load} loadFacets={() => Promise.resolve(FACETS)} />
        </>
      );
    }

    render(<RouterProvider router={createMemoryRouter([{ path: '/auditoria', element: <Harness /> }], { initialEntries: ['/auditoria?accion=x.y&desde=2026-03-01'] })} />);
    await screen.findByText('x.y');
    expect(load).toHaveBeenCalledWith({ ...NO_FILTER, action: 'x.y', from: '2026-03-01' });

    await userEvent.click(screen.getByRole('button', { name: 'otro log' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Quitar filtros' })).toBeNull());
    expect(screen.getByLabelText('Acción')).toHaveProperty('value', '');
    expect(dateField('Desde').value).toBe('');
  });

  it('says there is nothing yet, instead of drawing an empty table', async () => {
    renderView(loadOf({ items: [], nextCursor: null }));

    expect(await screen.findByText('Todavía no hay actividad registrada')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the actor by the name the server sends, not the uuid, and keeps tipo:id as the tooltip (WO-695)', async () => {
    const named = { ...entry('a', 'named.entry'), actor: { type: 'user', id: 'u1', name: 'Ana Pérez' } } as AuditLogEntryDto;
    renderView(loadOf({ items: [named], nextCursor: null }));

    const cell = await screen.findByText('Ana Pérez');

    expect(cell.getAttribute('title')).toBe('user:u1');
    expect(screen.queryByText('u1')).toBeNull();
    expect(screen.queryByText('user:u1')).toBeNull();
  });

  it('still draws tipo:id for an entry from an older server with no actor name (WO-695)', async () => {
    renderView(loadOf({ items: [entry('a', 'old.entry')], nextCursor: null }));

    const cell = await screen.findByText('user:u1');

    expect(cell.getAttribute('title')).toBe('user:u1');
  });

  it('says it could not load, and retrying reads again', async () => {
    const load = vi.fn<Load>().mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValueOnce({ items: [entry('a', 'back.again')], nextCursor: null });
    renderView(load);

    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('back.again')).toBeTruthy();
  });
});

describe('AuditLogView filters (WO-705, SDD-091)', () => {
  it('offers the actions the scope really has, with their counts, in the action select', async () => {
    renderView(loadOf({ items: [entry('a', 'document.published')], nextCursor: null }));

    expect(await screen.findByRole('option', { name: 'document.published (12)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'drift.acknowledged (3)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Todas las acciones' })).toBeTruthy();
  });

  it('asks the server for the three filters together: action, date range and person', async () => {
    const load = loadOf({ items: [entry('a', 'document.published')], nextCursor: null });
    renderView(load);
    await screen.findByText('document.published');

    await userEvent.selectOptions(screen.getByLabelText('Acción'), 'document.published');
    fireEvent.change(dateField('Desde'), { target: { value: '2026-03-01' } });
    fireEvent.change(dateField('Hasta'), { target: { value: '2026-03-07' } });
    await userEvent.selectOptions(screen.getByLabelText('Persona'), 'user:u1');

    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith({
        action: 'document.published',
        from: '2026-03-01',
        to: '2026-03-07',
        actorType: 'user',
        actorId: 'u1',
      }),
    );
  });

  it('the person select labels the actors by name and falls back to tipo:id when there is none', async () => {
    renderView(loadOf({ items: [entry('a', 'document.published')], nextCursor: null }));

    expect(await screen.findByRole('option', { name: 'Ana Ríos (9)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'agent:claude (6)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Todas las personas' })).toBeTruthy();
  });

  it('shows the total of the cut next to «Cargar más»', async () => {
    renderView(loadOf({ items: [entry('a', 'document.published')], nextCursor: 'c1', total: 3484 }));

    expect(await screen.findByText(lineText('Mostrando 1 de 3484'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBeTruthy();
  });

  it('an older server that sends no total draws no total line, and nothing else changes', async () => {
    renderView(loadOf({ items: [entry('a', 'document.published')], nextCursor: null }));

    await screen.findByText('document.published');

    expect(screen.queryByText(/Mostrando/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reproduces the filter a shared link carries when it mounts: ?desde= filters at once', async () => {
    const load = loadOf({ items: [entry('a', 'document.published')], nextCursor: null });
    renderView(load, { initialEntry: '/auditoria?desde=2026-03-01&hasta=2026-03-07&actor=user:u1&accion=document.published' });

    await waitFor(() =>
      expect(load).toHaveBeenCalledWith({ action: 'document.published', from: '2026-03-01', to: '2026-03-07', actorType: 'user', actorId: 'u1' }),
    );
    expect(dateField('Desde').value).toBe('2026-03-01');
    expect(dateField('Hasta').value).toBe('2026-03-07');
    expect(screen.getByLabelText('Persona')).toHaveProperty('value', 'user:u1');
  });

  it('a garbage date in the URL is dropped instead of breaking the screen', async () => {
    const load = loadOf({ items: [entry('a', 'document.published')], nextCursor: null });
    renderView(load, { initialEntry: '/auditoria?desde=ayer' });

    expect(await screen.findByText('document.published')).toBeTruthy();
    expect(load).toHaveBeenCalledWith(NO_FILTER);
    expect(dateField('Desde').value).toBe('');
  });

  it('keeps the filter in the URL, so reloading it later reproduces the cut', async () => {
    const router = renderView(loadOf({ items: [entry('a', 'document.published')], nextCursor: null }));
    await screen.findByText('document.published');

    await userEvent.selectOptions(screen.getByLabelText('Acción'), 'drift.acknowledged');

    await waitFor(() => expect(router.state.location.search).toBe('?accion=drift.acknowledged'));
  });

  it('a filter that came back with no entries still says there is nothing, instead of an empty table', async () => {
    renderView(loadOf({ items: [], nextCursor: null, total: 0 }), { initialEntry: '/auditoria?accion=nada.paso' });

    expect(await screen.findByText('Todavía no hay actividad registrada')).toBeTruthy();
  });
});
