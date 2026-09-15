/**
 * WO-214: the "create a comment thread from a selection" trigger inside the collaborative body editor.
 * Mirrors CommentsPanel.test.tsx's mocking pattern (mock `useCollabDocumentContext`, spy on the typed API
 * client) rather than inventing a new one. Selection changes are driven by dispatching directly on the
 * `EditorView` instance captured via the mocked `setEditorView` (same technique `comment-highlight.dom.test.tsx`
 * uses to drive CodeMirror state without relying on jsdom mouse/selection support).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EditorView } from '@codemirror/view';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollabEditor } from '../../src/components/CollabEditor.js';
import * as collabContext from '../../src/collab/collab-document-context.js';
import * as commentsApi from '../../src/api/comments.js';

function mockContext(body = 'hello world') {
  const ydoc = new Y.Doc({ gc: false });
  ydoc.getText('body').insert(0, body);
  let capturedView: EditorView | null = null;
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: { document: ydoc, awareness: null, on: () => {}, off: () => {} } as never,
    state: { status: 'connected', synced: true, scope: 'read-write', presence: [] },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'PRD-001',
    editorView: null,
    setEditorView: (view) => {
      capturedView = view;
    },
  });
  return { getView: () => capturedView };
}

const editorSubject = { orgRole: 'member', projectRole: 'editor' } as const;
const viewerSubject = { orgRole: 'member', projectRole: 'viewer' } as const;

describe('CollabEditor comment trigger (WO-214)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows no comment trigger when there is no selection', async () => {
    mockContext();
    render(<CollabEditor subject={editorSubject} />);
    await screen.findByTestId('collab-editor-container');

    expect(screen.queryByRole('button', { name: /comentar selección/i })).toBeNull();
  });

  it('shows the trigger once a non-empty selection exists, for a commenter', async () => {
    const { getView } = mockContext();
    render(<CollabEditor subject={editorSubject} />);
    await screen.findByTestId('collab-editor-container');

    act(() => {
      getView()!.dispatch({ selection: { anchor: 0, head: 5 } });
    });

    expect(await screen.findByRole('button', { name: /comentar selección/i })).toBeTruthy();
  });

  it('never shows the trigger to a viewer, even with a selection', async () => {
    const { getView } = mockContext();
    render(<CollabEditor subject={viewerSubject} />);
    await screen.findByTestId('collab-editor-container');

    act(() => {
      getView()!.dispatch({ selection: { anchor: 0, head: 5 } });
    });

    expect(screen.queryByRole('button', { name: /comentar selección/i })).toBeNull();
  });

  it('hides the trigger again once the selection collapses', async () => {
    const { getView } = mockContext();
    render(<CollabEditor subject={editorSubject} />);
    await screen.findByTestId('collab-editor-container');

    act(() => {
      getView()!.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    expect(await screen.findByRole('button', { name: /comentar selección/i })).toBeTruthy();

    act(() => {
      getView()!.dispatch({ selection: { anchor: 5, head: 5 } });
    });
    expect(screen.queryByRole('button', { name: /comentar selección/i })).toBeNull();
  });

  it('opens an inline form on click and creates a thread with the selection anchor and typed body', async () => {
    const { getView } = mockContext();
    const create = vi.spyOn(commentsApi, 'createCommentThread').mockResolvedValue({
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
      comments: [],
    });

    render(<CollabEditor subject={editorSubject} />);
    await screen.findByTestId('collab-editor-container');

    act(() => {
      getView()!.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    await userEvent.click(await screen.findByRole('button', { name: /comentar selección/i }));

    const input = screen.getByRole('textbox', { name: /nuevo comentario/i });
    await userEvent.type(input, 'ojo con esto');
    await userEvent.click(screen.getByRole('button', { name: /^comentar$/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('acme', 'web', 'PRD-001', { startIndex: 0, endIndex: 5, body: 'ojo con esto' }));
    // the inline form closes again after a successful create
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /nuevo comentario/i })).toBeNull());
  });

  it('closes the inline form on Escape without calling the API', async () => {
    const { getView } = mockContext();
    const create = vi.spyOn(commentsApi, 'createCommentThread').mockResolvedValue({} as never);

    render(<CollabEditor subject={editorSubject} />);
    await screen.findByTestId('collab-editor-container');

    act(() => {
      getView()!.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    await userEvent.click(await screen.findByRole('button', { name: /comentar selección/i }));

    const input = screen.getByRole('textbox', { name: /nuevo comentario/i });
    await userEvent.type(input, 'no enviar esto');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('textbox', { name: /nuevo comentario/i })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('a cancel button also closes the inline form without submitting', async () => {
    const { getView } = mockContext();
    render(<CollabEditor subject={editorSubject} />);
    await screen.findByTestId('collab-editor-container');

    act(() => {
      getView()!.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    await userEvent.click(await screen.findByRole('button', { name: /comentar selección/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(screen.queryByRole('textbox', { name: /nuevo comentario/i })).toBeNull();
  });
});
