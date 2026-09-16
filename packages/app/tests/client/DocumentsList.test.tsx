import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSummary } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { DocumentsList } from '../../src/routes/DocumentsList.js';
import { makeProjectShellContext } from './fixtures.js';

const DOCS: DocumentSummary[] = [
  { id: 'd1', docId: 'PRD-001', kind: 'PRD', title: 'Feature A', origin: 'collab', workflowState: 'draft', sourcePath: 'docs/prd/PRD-001.md', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'd2', docId: 'SDD-001', kind: 'SDD', title: 'Design A', origin: 'collab', workflowState: 'published', sourcePath: 'docs/sdd/SDD-001.md', updatedAt: '2026-01-02T00:00:00.000Z' },
];

function renderPage(orgRole: 'owner' | 'admin' | 'member', projectRole: 'admin' | 'editor' | 'viewer' = 'viewer') {
  const listDocuments = vi.spyOn(client, 'listDocuments').mockResolvedValue(DOCS);

  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext(orgRole, projectRole)} />, children: [{ index: true, element: <DocumentsList /> }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
  return { listDocuments };
}

describe('DocumentsList', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('lists documents and hides "Nuevo documento" for a viewer', async () => {
    renderPage('member', 'viewer');

    expect(await screen.findByText('PRD-001')).toBeTruthy();
    expect(screen.getByText('Design A')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nuevo documento' })).toBeNull();
  });

  it('shows "Nuevo documento" for an editor and creates one', async () => {
    renderPage('member', 'editor');
    await screen.findByText('PRD-001');

    const createDocument = vi.spyOn(client, 'createDocument').mockResolvedValue({
      id: 'd3',
      docId: 'ART-001',
      kind: 'ART',
      title: 'Notes',
      origin: 'collab',
      workflowState: 'draft',
      sourcePath: 'docs/artifacts/ART-001.md',
      updatedAt: '2026-01-01T00:00:00.000Z',
      latestVersion: null,
      publishedVersionId: null,
      publishedRaw: null,
      publishedContentHash: null,
      lastValidation: null,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo documento' }));
    await userEvent.selectOptions(screen.getByLabelText('Tipo de documento'), 'ART');
    await userEvent.type(screen.getByLabelText('Título'), 'Notes');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(createDocument).toHaveBeenCalledWith('acme', 'web', { kind: 'ART', title: 'Notes' }));
  });

  it('re-fetches with the selected kind filter', async () => {
    const { listDocuments } = renderPage('owner', 'admin');
    await screen.findByText('PRD-001');

    await userEvent.click(screen.getByRole('radio', { name: 'SDD' }));

    await waitFor(() => expect(listDocuments).toHaveBeenLastCalledWith('acme', 'web', { kind: 'SDD', workflowState: undefined }));
  });

  it('filters the visible rows by the search box, by id or title', async () => {
    renderPage('owner', 'admin');
    await screen.findByText('PRD-001');
    expect(screen.getByText('SDD-001')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Buscar por id o título'), 'design a');

    expect(screen.queryByText('PRD-001')).toBeNull();
    expect(screen.getByText('SDD-001')).toBeTruthy();
  });

  it('sorts by a column when its header button is clicked', async () => {
    renderPage('owner', 'admin');
    const idHeader = await screen.findByRole('button', { name: /^Id/ });

    await userEvent.click(idHeader);
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows[0]?.textContent).toContain('PRD-001');

    await userEvent.click(idHeader);
    const rowsDesc = screen.getAllByRole('row').slice(1);
    expect(rowsDesc[0]?.textContent).toContain('SDD-001');
  });
});
