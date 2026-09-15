import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSummary } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { DocumentsList } from '../../src/routes/DocumentsList.js';
import { OrgShell } from '../../src/routes/OrgShell.js';

const DOCS: DocumentSummary[] = [
  { id: 'd1', docId: 'PRD-001', kind: 'PRD', title: 'Feature A', origin: 'collab', workflowState: 'draft', sourcePath: 'docs/prd/PRD-001.md', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'd2', docId: 'SDD-001', kind: 'SDD', title: 'Design A', origin: 'collab', workflowState: 'published', sourcePath: 'docs/sdd/SDD-001.md', updatedAt: '2026-01-01T00:00:00.000Z' },
];

function renderPage(orgRole: 'owner' | 'admin' | 'member', projectRole?: 'admin' | 'editor' | 'viewer') {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: orgRole }]);
  vi.spyOn(client, 'listProjects').mockResolvedValue([]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Me' } });
  vi.spyOn(client, 'listProjectMembers').mockResolvedValue(projectRole ? [{ userId: 'u1', email: 'me@example.test', name: 'Me', role: projectRole }] : []);
  const listDocuments = vi.spyOn(client, 'listDocuments').mockResolvedValue(DOCS);

  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'p/:projectSlug/documents', element: <DocumentsList /> }] }],
    { initialEntries: ['/o/acme/p/web/documents'] },
  );
  render(<RouterProvider router={router} />);
  return { listDocuments };
}

describe('DocumentsList', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    const { listDocuments } = renderPage('owner');
    await screen.findByText('PRD-001');

    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'SDD');

    await waitFor(() => expect(listDocuments).toHaveBeenLastCalledWith('acme', 'web', { kind: 'SDD', workflowState: undefined }));
  });
});
