import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateDto, InboxItemDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { ApiClientError } from '../../src/api/api-client-error.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { Entrada } from '../../src/routes/Entrada.js';
import { makeProjectShellContext } from './fixtures.js';

const ITEMS: InboxItemDto[] = [
  { id: 'FB-007', kind: 'FB', title: 'Ver drift por rama', body: 'Texto del feedback', status: 'new', source: 'slack', links: [], receivedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'ART-002', kind: 'ART', title: 'Grabación de la daily', body: '', status: 'triaged', source: 'meeting', links: ['PRD-004'], receivedAt: '2026-01-02T00:00:00.000Z' },
];

const CANDIDATES: CandidateDto[] = [
  { featureId: 'FR-003', score: 0.92, reason: 'mention' },
  { featureId: 'PRD-004', score: 0.61, reason: 'score' },
];

function renderPage(): void {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('owner', 'admin')} />, children: [{ index: true, element: <Entrada /> }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('Entrada', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('lists every feedback and artifact item', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(ITEMS);
    renderPage();

    expect(await screen.findByText('FB-007')).toBeTruthy();
    expect(screen.getByText('ART-002')).toBeTruthy();
  });

  it('shows an empty state when the inbox is empty', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Todavía no hay feedback ni artifacts para este proyecto')).toBeTruthy();
  });

  it('filters by estado chip and by tipo select', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(ITEMS);
    renderPage();
    await screen.findByText('FB-007');

    await userEvent.click(screen.getByRole('radio', { name: /Triados/ }));
    expect(screen.getByText('ART-002')).toBeTruthy();
    expect(screen.queryByText('FB-007')).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: /Todos/ }));
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'FB');
    expect(screen.getByText('FB-007')).toBeTruthy();
    expect(screen.queryByText('ART-002')).toBeNull();
  });

  it('links a feedback item to the best-matching candidate', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(ITEMS);
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
    vi.spyOn(client, 'listInbox').mockResolvedValue(ITEMS);
    vi.spyOn(client, 'getFeedbackCandidates').mockResolvedValue(CANDIDATES);
    vi.spyOn(client, 'triageFeedback').mockRejectedValue(new ApiClientError(409, 'unknown', 'pending republish'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Enlazar a feature' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enlazar a feature' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enlazar' }));

    expect(await screen.findByText(/se va a aplicar recién cuando se republique el documento/)).toBeTruthy();
  });

  it('registers new feedback', async () => {
    vi.spyOn(client, 'listInbox').mockResolvedValue(ITEMS);
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
