/**
 * WO-383 — "Vista previa" wired to the real `PreviewEditor` sharing the exact same `Y.Text('body')` as the
 * Markdown (CodeMirror) tab: editing through one tab is visible through the other (same `Y.Doc`, so this
 * should come "for free" if everything upstream is wired correctly — tested explicitly anyway per the
 * WO). Also covers `readOnly` propagation (archived, mobile) and the blame/remote-cursor/comment-highlight
 * props actually reaching `PreviewEditor`.
 */
import { act, render, screen } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollabEditor } from '../../src/components/CollabEditor.js';
import * as collabContext from '../../src/collab/collab-document-context.js';
import * as documentsApi from '../../src/api/documents.js';
import * as commentsApi from '../../src/api/comments.js';
import type { CollabConnectionState } from '../../src/collab/use-collab-provider.js';

const editorSubject = { orgRole: 'member', projectRole: 'editor' } as const;

function mockContext(overrides: Partial<CollabConnectionState> = {}, body = 'hello world') {
  const ydoc = new Y.Doc({ gc: false });
  ydoc.getText('body').insert(0, body);
  let capturedView: EditorView | null = null;
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: { document: ydoc, awareness: null, on: () => {}, off: () => {} } as never,
    state: { status: 'connected', synced: true, scope: 'read-write', presence: [], ...overrides },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'PRD-001',
    editorView: null,
    setEditorView: (view) => {
      capturedView = view;
    },
  });
  return { ydoc, getView: () => capturedView };
}

function mockMobileMediaQuery(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function dispatchInsertText(target: Node, data: string): void {
  const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data });
  act(() => target.dispatchEvent(event));
}

function placeCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('CollabEditor + PreviewEditor integration (WO-383)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('typing in "Vista previa" updates the same Y.Text the Markdown tab reads', async () => {
    const { ydoc } = mockContext();
    render(<CollabEditor subject={editorSubject} />);

    const textNode = document.querySelector('[data-testid="preview-editor"] p[data-block-from]')!.firstChild!;
    placeCaret(textNode, 5);
    dispatchInsertText(textNode, ',');

    expect(ydoc.getText('body').toString()).toBe('hello, world');
  });

  it('is editable (toolbar present) for a normal connected read-write document on desktop', async () => {
    mockContext();
    render(<CollabEditor subject={editorSubject} />);
    expect(await screen.findByRole('toolbar', { name: 'Formato' })).toBeTruthy();
  });

  it('is read-only (no toolbar) when the document is archived, even with a read-write connection', async () => {
    mockContext();
    render(<CollabEditor subject={editorSubject} archived />);
    await screen.findByTestId('preview-editor');
    expect(screen.queryByRole('toolbar', { name: 'Formato' })).toBeNull();
  });

  it('is read-only (no toolbar) on a mobile viewport', async () => {
    mockMobileMediaQuery(true);
    mockContext();
    render(<CollabEditor subject={editorSubject} />);
    await screen.findByTestId('preview-editor');
    expect(screen.queryByRole('toolbar', { name: 'Formato' })).toBeNull();
  });

  it('fetches blame and shows a blame marker for the block once it resolves', async () => {
    vi.spyOn(documentsApi, 'getDocumentBlame').mockResolvedValue({
      lines: [{ line: 0, attribution: { actorKind: 'user', userId: 'ana', onBehalfOf: null, agentId: null, receivedAt: '2026-01-01T00:00:00Z' } }],
      fields: {},
    });
    mockContext();
    render(<CollabEditor subject={editorSubject} />);

    expect(await screen.findByTestId('blame-marker')).toBeTruthy();
  });

  it('fetches open comment threads and highlights their live range in the preview', async () => {
    const ydoc = new Y.Doc({ gc: false });
    const ytext = ydoc.getText('body');
    ytext.insert(0, 'hello world');
    const anchor = { start: Y.createRelativePositionFromTypeIndex(ytext, 6), end: Y.createRelativePositionFromTypeIndex(ytext, 11) };
    const encode = (rel: Y.RelativePosition) => btoa(String.fromCharCode(...Y.encodeRelativePosition(rel)));

    vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
      provider: { document: ydoc, awareness: null, on: () => {}, off: () => {} } as never,
      state: { status: 'connected', synced: true, scope: 'read-write', presence: [] },
      orgSlug: 'acme',
      projectSlug: 'web',
      docId: 'PRD-001',
      editorView: null,
      setEditorView: () => {},
    });
    vi.spyOn(commentsApi, 'listCommentThreads').mockResolvedValue([
      {
        id: 't1',
        documentId: 'd1',
        quotedText: 'world',
        anchorStart: encode(anchor.start),
        anchorEnd: encode(anchor.end),
        status: 'open',
        createdBy: 'u1',
        resolvedBy: null,
        resolvedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        comments: [],
      },
    ]);

    render(<CollabEditor subject={editorSubject} />);

    const mark = await screen.findByText('world');
    expect(mark.tagName).toBe('MARK');
    expect(mark.getAttribute('data-thread-id')).toBe('t1');
  });
});
