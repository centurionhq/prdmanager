import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetail as DocumentDetailDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { DocumentDetail } from '../../src/routes/DocumentDetail.js';
import { OrgShell } from '../../src/routes/OrgShell.js';

function baseDoc(overrides: Partial<DocumentDetailDto> = {}): DocumentDetailDto {
  return {
    id: 'd1',
    docId: 'PRD-001',
    kind: 'PRD',
    title: 'Feature A',
    origin: 'collab',
    workflowState: 'draft',
    sourcePath: 'docs/prd/PRD-001.md',
    updatedAt: '2026-01-01T00:00:00.000Z',
    latestVersion: { id: 'v1', versionNo: 1, reason: 'manual', renderedMarkdown: '---\nid: PRD-001\n---\n\nBody', frontmatter: {}, contentHash: 'hash1', createdAt: '2026-01-01T00:00:00.000Z' },
    publishedVersionId: null,
    publishedRaw: null,
    publishedContentHash: null,
    ...overrides,
  };
}

function renderPage(doc: DocumentDetailDto, projectRole: 'admin' | 'editor' | 'viewer') {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'member' }]);
  vi.spyOn(client, 'listProjects').mockResolvedValue([]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Me' } });
  vi.spyOn(client, 'listProjectMembers').mockResolvedValue([{ userId: 'u1', email: 'me@example.test', name: 'Me', role: projectRole }]);
  vi.spyOn(client, 'getDocument').mockResolvedValue(doc);

  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'p/:projectSlug/documents/:docId', element: <DocumentDetail /> }] }],
    { initialEntries: ['/o/acme/p/web/documents/PRD-001'] },
  );
  render(<RouterProvider router={router} />);
}

describe('DocumentDetail', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows content read-only and no actions for a viewer', async () => {
    renderPage(baseDoc(), 'viewer');

    expect(await screen.findByRole('heading', { name: 'Feature A' })).toBeTruthy();
    expect(screen.getByText('PRD-001 · PRD · draft')).toBeTruthy();
    expect(screen.getByText(/Body/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Solicitar revisión' })).toBeNull();
  });

  it('an editor can request review on a draft', async () => {
    renderPage(baseDoc(), 'editor');
    await screen.findByRole('heading', { name: 'Feature A' });

    const requestReview = vi.spyOn(client, 'requestDocumentReview').mockResolvedValue({
      id: 'd1',
      docId: 'PRD-001',
      kind: 'PRD',
      title: 'Feature A',
      origin: 'collab',
      workflowState: 'in_review',
      sourcePath: 'docs/prd/PRD-001.md',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Solicitar revisión' }));

    await waitFor(() => expect(requestReview).toHaveBeenCalledWith('acme', 'web', 'PRD-001'));
  });

  it('an editor cannot publish (button hidden); an admin can, and a work-order failure shows a retry', async () => {
    const inReview = baseDoc({ workflowState: 'in_review', kind: 'SDD' });
    renderPage(inReview, 'editor');
    await screen.findByRole('heading', { name: 'Feature A' });
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
  });

  it('an admin publishes an SDD and sees a retry action when work order generation fails', async () => {
    const inReview = baseDoc({ workflowState: 'in_review', kind: 'SDD' });
    renderPage(inReview, 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    const publish = vi.spyOn(client, 'publishDocument').mockResolvedValue({
      document: baseDoc({ workflowState: 'published', kind: 'SDD', publishedRaw: 'published content' }),
      workOrders: { generated: false, created: 0, error: 'boom' },
    });
    vi.spyOn(client, 'getDocument').mockResolvedValue(baseDoc({ workflowState: 'published', kind: 'SDD', publishedRaw: 'published content' }));

    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith('acme', 'web', 'PRD-001', { versionId: 'v1', contentHash: 'hash1' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar generación de work orders' })).toBeTruthy();
  });

  it('hides "Cerrar feature" for a non-approved published feature and for a non-admin', async () => {
    const approved = baseDoc({
      workflowState: 'published',
      publishedRaw: 'content',
      latestVersion: { id: 'v1', versionNo: 2, reason: 'published', renderedMarkdown: 'content', frontmatter: { status: 'approved' }, contentHash: 'hash2', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    renderPage(approved, 'editor');
    await screen.findByRole('heading', { name: 'Feature A' });
    expect(screen.queryByRole('button', { name: 'Cerrar feature' })).toBeNull();

    const draftStatus = baseDoc({
      workflowState: 'published',
      publishedRaw: 'content',
      latestVersion: { id: 'v1', versionNo: 2, reason: 'published', renderedMarkdown: 'content', frontmatter: { status: 'draft' }, contentHash: 'hash2', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    renderPage(draftStatus, 'admin');
    await screen.findAllByRole('heading', { name: 'Feature A' });
    expect(screen.queryByRole('button', { name: 'Cerrar feature' })).toBeNull();
  });

  it('an admin closes an approved feature after reviewing readiness checks', async () => {
    const approved = baseDoc({
      workflowState: 'published',
      publishedRaw: 'content',
      latestVersion: { id: 'v1', versionNo: 2, reason: 'published', renderedMarkdown: 'content', frontmatter: { status: 'approved' }, contentHash: 'hash2', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    renderPage(approved, 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    const readiness = vi.spyOn(client, 'getClosureReadiness').mockResolvedValue({
      featureId: 'PRD-001',
      ready: true,
      checks: [{ name: 'feature_approved', ok: true, detail: 'PRD-001 is approved' }],
    });
    const close = vi.spyOn(client, 'closeFeature').mockResolvedValue({ result: { featureId: 'PRD-001', closedAt: '2026-01-02T00:00:00.000Z', closedBy: 'dev:u1' }, pendingEditablePatch: true });

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar feature' }));
    await waitFor(() => expect(readiness).toHaveBeenCalledWith('acme', 'web', 'PRD-001'));
    expect(await screen.findByText(/PRD-001 is approved/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    await waitFor(() => expect(close).toHaveBeenCalledWith('acme', 'web', 'PRD-001'));
    expect(await screen.findByText(/Feature cerrada/)).toBeTruthy();
  });

  it('disables confirmation when the feature is not actually ready', async () => {
    const approved = baseDoc({
      workflowState: 'published',
      publishedRaw: 'content',
      latestVersion: { id: 'v1', versionNo: 2, reason: 'published', renderedMarkdown: 'content', frontmatter: { status: 'approved' }, contentHash: 'hash2', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    renderPage(approved, 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    vi.spyOn(client, 'getClosureReadiness').mockResolvedValue({
      featureId: 'PRD-001',
      ready: false,
      checks: [{ name: 'work_orders_done', ok: false, detail: 'pending work order(s): WO-002' }],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar feature' }));
    expect(await screen.findByText(/pending work order/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirmar cierre' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('an admin can archive a published document', async () => {
    renderPage(baseDoc({ workflowState: 'published', publishedRaw: 'content here' }), 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    const archive = vi.spyOn(client, 'archiveDocument').mockResolvedValue({
      id: 'd1',
      docId: 'PRD-001',
      kind: 'PRD',
      title: 'Feature A',
      origin: 'collab',
      workflowState: 'archived',
      sourcePath: 'docs/prd/PRD-001.md',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith('acme', 'web', 'PRD-001'));
  });
});
