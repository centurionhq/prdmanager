import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentDetail as DocumentDetailDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { DocumentDetail } from '../../src/routes/DocumentDetail.js';
import { makeProjectShellContext } from './fixtures.js';

function baseDoc(overrides: Partial<DocumentDetailDto> = {}): DocumentDetailDto {
  return {
    id: 'd1',
    docId: 'PRD-001',
    kind: 'PRD',
    title: 'Feature A',
    // Not 'collab': these tests exercise workflow-action gating against the static read-only body view,
    // orthogonal to WO-159's live editor — a dedicated test below covers a 'collab'-origin document
    // rendering the real CollabEditor instead.
    origin: 'generated',
    workflowState: 'draft',
    sourcePath: 'docs/prd/PRD-001.md',
    updatedAt: '2026-01-01T00:00:00.000Z',
    latestVersion: { id: 'v1', versionNo: 1, label: null, reason: 'manual', renderedMarkdown: '---\nid: PRD-001\n---\n\nBody', frontmatter: {}, contentHash: 'hash1', contributors: [], createdAt: '2026-01-01T00:00:00.000Z' },
    publishedVersionId: null,
    publishedRaw: null,
    publishedContentHash: null,
    lastValidation: null,
    ...overrides,
  };
}

function renderPage(doc: DocumentDetailDto, projectRole: 'admin' | 'editor' | 'viewer') {
  vi.spyOn(client, 'getDocument').mockResolvedValue(doc);

  const router = createMemoryRouter(
    [{ path: '/ctx/:docId', element: <Outlet context={makeProjectShellContext('member', projectRole)} />, children: [{ index: true, element: <DocumentDetail /> }] }],
    { initialEntries: ['/ctx/PRD-001'] },
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

  it('an editor cannot publish (button hidden); an admin can', async () => {
    const inReview = baseDoc({ workflowState: 'in_review', kind: 'SDD' });
    renderPage(inReview, 'editor');
    await screen.findByRole('heading', { name: 'Feature A' });
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
  });

  it('publishing opens a review screen; confirming there is what actually calls publishDocument', async () => {
    const inReview = baseDoc({ workflowState: 'in_review', kind: 'SDD' });
    renderPage(inReview, 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    const publish = vi.spyOn(client, 'publishDocument').mockResolvedValue({
      document: baseDoc({ workflowState: 'published', kind: 'SDD', publishedRaw: 'published content' }),
      workOrders: { generated: true, created: 0 },
    });
    vi.spyOn(client, 'getDocument').mockResolvedValue(baseDoc({ workflowState: 'published', kind: 'SDD', publishedRaw: 'published content' }));

    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(screen.getByRole('heading', { name: 'Revisar antes de publicar' })).toBeTruthy();
    expect(publish).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Publicar versión 1' }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith('acme', 'web', 'PRD-001', { versionId: 'v1', contentHash: 'hash1' }));
  });

  it('an admin sees a retry action when work order generation fails after confirming publish', async () => {
    const inReview = baseDoc({ workflowState: 'in_review', kind: 'SDD' });
    renderPage(inReview, 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    vi.spyOn(client, 'publishDocument').mockResolvedValue({
      document: baseDoc({ workflowState: 'published', kind: 'SDD', publishedRaw: 'published content' }),
      workOrders: { generated: false, created: 0, error: 'boom' },
    });
    vi.spyOn(client, 'getDocument').mockResolvedValue(baseDoc({ workflowState: 'published', kind: 'SDD', publishedRaw: 'published content' }));

    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publicar versión 1' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar generación de work orders' })).toBeTruthy();
  });

  it('closing the review screen without confirming never publishes', async () => {
    const inReview = baseDoc({ workflowState: 'in_review', kind: 'SDD' });
    renderPage(inReview, 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    const publish = vi.spyOn(client, 'publishDocument');

    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Volver a editar' }));

    expect(screen.queryByRole('heading', { name: 'Revisar antes de publicar' })).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it('hides "Cerrar feature" for a non-approved published feature and for a non-admin', async () => {
    const approved = baseDoc({
      workflowState: 'published',
      publishedRaw: 'content',
      latestVersion: { id: 'v1', versionNo: 2, label: null, reason: 'published', renderedMarkdown: 'content', frontmatter: { status: 'approved' }, contentHash: 'hash2', contributors: [], createdAt: '2026-01-01T00:00:00.000Z' },
    });
    renderPage(approved, 'editor');
    await screen.findByRole('heading', { name: 'Feature A' });
    expect(screen.queryByRole('button', { name: 'Cerrar feature' })).toBeNull();

    const draftStatus = baseDoc({
      workflowState: 'published',
      publishedRaw: 'content',
      latestVersion: { id: 'v1', versionNo: 2, label: null, reason: 'published', renderedMarkdown: 'content', frontmatter: { status: 'draft' }, contentHash: 'hash2', contributors: [], createdAt: '2026-01-01T00:00:00.000Z' },
    });
    renderPage(draftStatus, 'admin');
    await screen.findAllByRole('heading', { name: 'Feature A' });
    expect(screen.queryByRole('button', { name: 'Cerrar feature' })).toBeNull();
  });

  it('an admin closes an approved feature after reviewing readiness checks', async () => {
    const approved = baseDoc({
      workflowState: 'published',
      publishedRaw: 'content',
      latestVersion: { id: 'v1', versionNo: 2, label: null, reason: 'published', renderedMarkdown: 'content', frontmatter: { status: 'approved' }, contentHash: 'hash2', contributors: [], createdAt: '2026-01-01T00:00:00.000Z' },
    });
    renderPage(approved, 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    const readiness = vi.spyOn(client, 'getClosureReadiness').mockResolvedValue({
      featureId: 'PRD-001',
      ready: true,
      checks: [{ name: 'feature_approved', ok: true, detail: 'PRD-001 is approved' }],
    });
    const close = vi.spyOn(client, 'closeFeature').mockResolvedValue({ result: { featureId: 'PRD-001', closedAt: '2026-01-02T00:00:00.000Z', closedBy: 'dev:u1' } });

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
      latestVersion: { id: 'v1', versionNo: 2, label: null, reason: 'published', renderedMarkdown: 'content', frontmatter: { status: 'approved' }, contentHash: 'hash2', contributors: [], createdAt: '2026-01-01T00:00:00.000Z' },
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

  it('renders a generated document as formatted markdown, never as raw source (WO-466, SDD-034)', async () => {
    const raw = ['---', 'id: "FB-018"', 'type: "FB"', 'status: "new"', '---', '', '## Feedback', '', 'Primer punto del cuerpo.', '', '- una viñeta', ''].join('\n');
    renderPage(baseDoc({ workflowState: 'published', kind: 'FB', origin: 'generated', publishedRaw: raw }), 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    // "## Feedback" becomes a real heading, and the bullet a real list item -- not literal text.
    expect(await screen.findByRole('heading', { name: 'Feedback' })).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe('una viñeta');
    expect(screen.getByText('Primer punto del cuerpo.')).toBeTruthy();

    // The YAML block never reaches the reader: not as a heading, not as loose text.
    expect(screen.queryByText(/id: "FB-018"/)).toBeNull();
    expect(screen.queryByText(/^---$/)).toBeNull();
    expect(document.body.textContent).not.toContain('type: "FB"');
    expect(document.body.textContent).not.toContain('## Feedback');
  });

  it('renders a document that has no frontmatter whole, without truncating it (WO-466, SDD-034)', async () => {
    renderPage(baseDoc({ workflowState: 'published', kind: 'WO', origin: 'generated', publishedRaw: '# Sin frontmatter\n\nTodo el cuerpo sigue acá.' }), 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    expect(await screen.findByRole('heading', { name: 'Sin frontmatter' })).toBeTruthy();
    expect(screen.getByText('Todo el cuerpo sigue acá.')).toBeTruthy();
  });

  it('shows the frontmatter relations as data once the raw YAML is gone (WO-467, SDD-034)', async () => {
    const doc = baseDoc({ workflowState: 'published', kind: 'FB', origin: 'generated', publishedRaw: '---\nid: "FB-018"\n---\n\nCuerpo.' });
    const withLinks = { ...doc, latestVersion: doc.latestVersion ? { ...doc.latestVersion, frontmatter: { id: 'FB-018', justified_by: ['BC-002'], informs: ['PRD-008'] } } : null };
    renderPage(withLinks, 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    expect(await screen.findByText('justified_by')).toBeTruthy();
    expect(screen.getByText('BC-002')).toBeTruthy();
    expect(screen.getByText('informs')).toBeTruthy();
    expect(screen.getByText('PRD-008')).toBeTruthy();
  });

  it('shows an explicit empty state for a document with no body, not a blank card (WO-467, SDD-034)', async () => {
    renderPage(baseDoc({ workflowState: 'published', kind: 'WO', origin: 'generated', publishedRaw: '---\nid: "WO-999"\n---\n' }), 'admin');
    await screen.findByRole('heading', { name: 'Feature A' });

    expect(await screen.findByText(/todavía no tiene contenido/i)).toBeTruthy();
  });

  it('shows a retryable error state when the document fails to load (WO-467, SDD-034)', async () => {
    vi.spyOn(client, 'getDocument').mockRejectedValueOnce(new Error('documento caído'));
    renderPage(baseDoc({ workflowState: 'published', origin: 'generated' }), 'admin');

    expect(await screen.findByText(/no pudimos cargar el documento/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeTruthy();
  });

  it('a business case gets the writing guide beside the editor (WO-561, SDD-053)', async () => {
    renderPage(baseDoc({ docId: 'BC-014', kind: 'BC', title: 'Notificar cuando una orden se atrasa', origin: 'collab' }), 'editor');
    await screen.findByRole('heading', { name: 'Notificar cuando una orden se atrasa' });

    const guide = await screen.findByRole('complementary', { name: 'Guía del caso de negocio' });
    expect(guide.textContent).toContain('El problema');
    // The frontmatter form is still there, which is where `justified_by` can be fixed by hand (WO-557).
    expect(screen.getByLabelText('Justificado por')).toBeTruthy();
  });

  it('every other kind keeps the document screen it had, with no guide', async () => {
    renderPage(baseDoc({ origin: 'collab' }), 'editor');
    await screen.findByRole('heading', { name: 'Feature A' });

    expect(await screen.findByTestId('collab-editor-container')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Guía del caso de negocio' })).toBeNull();
  });

  it('a collab-origin document renders the live CollabEditor instead of the static body view', async () => {
    renderPage(baseDoc({ origin: 'collab' }), 'editor');
    await screen.findByRole('heading', { name: 'Feature A' });

    // The editor mounts (and immediately starts — then fails, since nothing is listening — a real
    // WebSocket connection attempt in jsdom); asserting on the container's presence and the status bar
    // is enough here, never waiting for an actual sync no test server exists to provide.
    expect(await screen.findByTestId('collab-editor-container')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
