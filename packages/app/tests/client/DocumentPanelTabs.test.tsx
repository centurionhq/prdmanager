import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as collabContext from '../../src/collab/collab-document-context.js';
import * as agentApi from '../../src/api/agent.js';
import * as commentsApi from '../../src/api/comments.js';
import * as versionsApi from '../../src/api/versions.js';
import { DocumentPanelTabs } from '../../src/routes/DocumentPanelTabs.js';

const subject = { orgRole: 'member', projectRole: 'editor' } as const;

function mockContext() {
  const ydoc = new Y.Doc({ gc: false });
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: { document: ydoc, awareness: null, on: () => {}, off: () => {} } as never,
    state: { status: 'connected', synced: true, scope: 'read-write', presence: [] },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'PRD-001',
    editorView: null,
    setEditorView: () => {},
  });
}

describe('DocumentPanelTabs (WO-359)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the "Agente" tab and switches panels on click without remounting logic twice', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue({ messages: [], proposals: [] });
    const listComments = vi.spyOn(commentsApi, 'listCommentThreads').mockResolvedValue([]);
    const listVersions = vi.spyOn(versionsApi, 'listDocumentVersions').mockResolvedValue({ versions: [], total: 0, limit: 20, offset: 0 });

    render(
      <DocumentPanelTabs
        subject={subject}
        lastValidation={null}
        canRequestReview={false}
        canPublish={false}
        canArchive={false}
        busy={false}
        onRequestReview={() => {}}
        onPublish={() => {}}
        onArchive={() => {}}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Agente' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByLabelText(/Mensaje para el agente/)).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Comentarios' }));
    expect(await screen.findByRole('region', { name: 'Comentarios' })).toBeTruthy();
    expect(listComments).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: 'Versiones' }));
    expect(await screen.findByRole('region', { name: 'Versiones' })).toBeTruthy();
    expect(listVersions).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: 'Validación' }));
    expect(await screen.findByRole('region', { name: 'Validación' })).toBeTruthy();
    expect(screen.getByText('Sin problemas de validación.')).toBeTruthy();
  });

  it('the Validación tab publish action calls the real onPublish passed in', async () => {
    mockContext();
    vi.spyOn(agentApi, 'getAgentConversation').mockResolvedValue({ messages: [], proposals: [] });
    const onPublish = vi.fn();
    const adminSubject = { orgRole: 'member', projectRole: 'admin' } as const;

    render(
      <DocumentPanelTabs
        subject={adminSubject}
        lastValidation={[]}
        canRequestReview={false}
        canPublish
        canArchive={false}
        busy={false}
        onRequestReview={() => {}}
        onPublish={onPublish}
        onArchive={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Validación' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));

    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});
