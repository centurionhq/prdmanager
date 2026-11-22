/**
 * WO-582 (SDD-056/PRD-036 R2): the audit body the project's and the organisation's screens share. The screens'
 * own tests keep covering what each one reads; these cover what only the shared body can get wrong.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuditLogEntryDto } from '@prdm/contracts';
import { AuditLogView } from '../../src/routes/audit/AuditLogView.js';

function entry(id: string, action: string): AuditLogEntryDto {
  return { id, createdAt: '2026-09-20T10:00:00.000Z', actor: { type: 'user', id: 'u1' }, action, target: 'WO-001', metadata: {} } as AuditLogEntryDto;
}

describe('AuditLogView (WO-582, SDD-056)', () => {
  it('reads the first page with no filter and draws it', async () => {
    const load = vi.fn().mockResolvedValue({ items: [entry('a', 'document.published')], nextCursor: null });
    render(<AuditLogView scopeKey="acme/web" load={load} />);

    expect(await screen.findByText('document.published')).toBeTruthy();
    expect(load).toHaveBeenCalledWith({ action: undefined });
  });

  it('filters by the exact action typed, and offers to take the filter off once it is on', async () => {
    const load = vi.fn().mockResolvedValue({ items: [entry('a', 'document.published')], nextCursor: null });
    render(<AuditLogView scopeKey="acme/web" load={load} />);
    await screen.findByText('document.published');
    expect(screen.queryByRole('button', { name: 'Quitar filtro' })).toBeNull();

    await userEvent.type(screen.getByLabelText('Filtrar por acción'), 'drift.acknowledged');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ action: 'drift.acknowledged' }));
    expect(await screen.findByRole('button', { name: 'Quitar filtro' })).toBeTruthy();
  });

  it('taking the filter off reads the unfiltered log again and empties the field', async () => {
    const load = vi.fn().mockResolvedValue({ items: [entry('a', 'x.y')], nextCursor: null });
    render(<AuditLogView scopeKey="acme/web" load={load} />);
    await screen.findByText('x.y');
    await userEvent.type(screen.getByLabelText('Filtrar por acción'), 'x.y');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar filtro' }));

    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ action: undefined }));
    expect((screen.getByLabelText('Filtrar por acción') as HTMLInputElement).value).toBe('');
  });

  it('a filter is trimmed: a stray space is not part of the action', async () => {
    const load = vi.fn().mockResolvedValue({ items: [entry('a', 'x.y')], nextCursor: null });
    render(<AuditLogView scopeKey="acme/web" load={load} />);
    await screen.findByText('x.y');

    await userEvent.type(screen.getByLabelText('Filtrar por acción'), '  x.y  ');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ action: 'x.y' }));
  });

  it('pages with the cursor it was given and appends, never replacing what is on screen', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ items: [entry('a', 'first.page')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [entry('b', 'second.page')], nextCursor: null });
    render(<AuditLogView scopeKey="acme/web" load={load} />);
    await screen.findByText('first.page');

    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));

    expect(await screen.findByText('second.page')).toBeTruthy();
    expect(screen.getByText('first.page')).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith({ action: undefined, cursor: 'c1' });
  });

  it('showing another log starts clean: the previous filter does not follow it', async () => {
    const load = vi.fn().mockResolvedValue({ items: [entry('a', 'x.y')], nextCursor: null });
    const { rerender } = render(<AuditLogView scopeKey="acme/web" load={load} />);
    await screen.findByText('x.y');
    await userEvent.type(screen.getByLabelText('Filtrar por acción'), 'x.y');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    await screen.findByRole('button', { name: 'Quitar filtro' });

    rerender(<AuditLogView scopeKey="acme/api" load={load} />);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Quitar filtro' })).toBeNull());
    expect((screen.getByLabelText('Filtrar por acción') as HTMLInputElement).value).toBe('');
  });

  it('says there is nothing yet, instead of drawing an empty table', async () => {
    render(<AuditLogView scopeKey="acme/web" load={vi.fn().mockResolvedValue({ items: [], nextCursor: null })} />);

    expect(await screen.findByText('Todavía no hay actividad registrada')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the actor by the name the server sends, not the uuid, and keeps tipo:id as the tooltip (WO-695)', async () => {
    const named = { ...entry('a', 'named.entry'), actor: { type: 'user', id: 'u1', name: 'Ana Pérez' } } as AuditLogEntryDto;
    render(<AuditLogView scopeKey="acme/web" load={vi.fn().mockResolvedValue({ items: [named], nextCursor: null })} />);

    const cell = await screen.findByText('Ana Pérez');

    expect(cell.getAttribute('title')).toBe('user:u1');
    expect(screen.queryByText('u1')).toBeNull();
    expect(screen.queryByText('user:u1')).toBeNull();
  });

  it('still draws tipo:id for an entry from an older server with no actor name (WO-695)', async () => {
    render(<AuditLogView scopeKey="acme/web" load={vi.fn().mockResolvedValue({ items: [entry('a', 'old.entry')], nextCursor: null })} />);

    const cell = await screen.findByText('user:u1');

    expect(cell.getAttribute('title')).toBe('user:u1');
  });

  it('says it could not load, and retrying reads again', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValueOnce({ items: [entry('a', 'back.again')], nextCursor: null });
    render(<AuditLogView scopeKey="acme/web" load={load} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('back.again')).toBeTruthy();
  });
});
