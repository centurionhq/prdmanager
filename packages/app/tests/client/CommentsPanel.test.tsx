import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommentThreadSummary } from '@prdm/contracts';
import { CommentsPanel } from '../../src/components/CommentsPanel.js';
import * as collabContext from '../../src/collab/collab-document-context.js';
import * as commentsApi from '../../src/api/comments.js';

function fakeThread(overrides: Partial<CommentThreadSummary> = {}): CommentThreadSummary {
  return {
    id: 't1',
    documentId: 'd1',
    quotedText: 'hello',
    anchorStart: '',
    anchorEnd: '',
    status: 'open',
    createdBy: 'u1',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    comments: [{ id: 'c1', authorId: 'u1', body: 'first comment', createdAt: '2026-01-01T00:00:00.000Z', editedAt: null, deletedAt: null }],
    ...overrides,
  };
}

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

describe('CommentsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists threads and their comments', async () => {
    mockContext();
    vi.spyOn(commentsApi, 'listCommentThreads').mockResolvedValue([fakeThread()]);

    render(<CommentsPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);

    expect(await screen.findByText('hello')).toBeTruthy();
    expect(screen.getByText('first comment')).toBeTruthy();
  });

  it('an editor (comment permission) can reply and resolve; a viewer cannot', async () => {
    mockContext();
    vi.spyOn(commentsApi, 'listCommentThreads').mockResolvedValue([fakeThread()]);
    const reply = vi.spyOn(commentsApi, 'replyToCommentThread').mockResolvedValue({ id: 'c2', authorId: 'u1', body: 'a reply', createdAt: '', editedAt: null, deletedAt: null });

    render(<CommentsPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('hello');

    expect(screen.getByRole('button', { name: 'Resolver' })).toBeTruthy();

    const input = screen.getByLabelText(/Responder al hilo/);
    await userEvent.type(input, 'a reply');
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }));

    await waitFor(() => expect(reply).toHaveBeenCalledWith('acme', 'web', 'PRD-001', 't1', { body: 'a reply' }));
  });

  it('a viewer sees threads but no reply/resolve controls', async () => {
    mockContext();
    vi.spyOn(commentsApi, 'listCommentThreads').mockResolvedValue([fakeThread()]);

    render(<CommentsPanel subject={{ orgRole: 'member', projectRole: 'viewer' }} />);
    await screen.findByText('hello');

    expect(screen.queryByRole('button', { name: 'Resolver' })).toBeNull();
    expect(screen.queryByLabelText(/Responder al hilo/)).toBeNull();
  });

  it('resolving a thread calls the API and reloads the list', async () => {
    mockContext();
    vi.spyOn(commentsApi, 'listCommentThreads').mockResolvedValue([fakeThread()]);
    const resolve = vi.spyOn(commentsApi, 'resolveCommentThread').mockResolvedValue(fakeThread({ status: 'resolved' }));

    render(<CommentsPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('hello');

    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('acme', 'web', 'PRD-001', 't1'));
  });

  it('filtering to "resolved" hides an open thread', async () => {
    mockContext();
    vi.spyOn(commentsApi, 'listCommentThreads').mockResolvedValue([fakeThread()]);

    render(<CommentsPanel subject={{ orgRole: 'member', projectRole: 'editor' }} />);
    await screen.findByText('hello');

    await userEvent.click(screen.getByRole('button', { name: 'Resueltos' }));
    expect(screen.queryByText('hello')).toBeNull();
    expect(screen.getByText('Sin comentarios.')).toBeTruthy();
  });
});
