/**
 * WO-358: the "Vista previa"/"Markdown" tabs (`Documento.dc.html`) replacing the old single toggle
 * button, and the state banners (`DocumentoEstados.dc.html`) for archived/read-only/disconnected.
 * WO-383: "Vista previa" renders the real `PreviewEditor` (`data-testid="preview-editor"`) instead of the
 * old read-only `MarkdownPreview` bridge.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollabEditor } from '../../src/components/CollabEditor.js';
import * as collabContext from '../../src/collab/collab-document-context.js';
import type { CollabConnectionState } from '../../src/collab/use-collab-provider.js';

const editorSubject = { orgRole: 'member', projectRole: 'editor' } as const;

function mockContext(overrides: Partial<CollabConnectionState> = {}, body = 'hello world') {
  const ydoc = new Y.Doc({ gc: false });
  ydoc.getText('body').insert(0, body);
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: { document: ydoc, awareness: null, on: () => {}, off: () => {} } as never,
    state: { status: 'connected', synced: true, scope: 'read-write', presence: [], ...overrides },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'PRD-001',
    editorView: null,
    setEditorView: () => {},
  });
}

describe('CollabEditor tabs and state banners (WO-358)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the "Vista previa" tab, hiding the Markdown editor container', async () => {
    mockContext();
    render(<CollabEditor subject={editorSubject} />);

    const previewTab = await screen.findByRole('tab', { name: 'Vista previa' });
    const markdownTab = screen.getByRole('tab', { name: 'Markdown' });
    expect(previewTab.getAttribute('aria-selected')).toBe('true');
    expect(markdownTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('collab-editor-container').hasAttribute('hidden')).toBe(true);
    expect(screen.getByTestId('preview-editor')).toBeTruthy();
  });

  it('switching to "Markdown" reveals the CodeMirror container and hides the preview', async () => {
    mockContext();
    render(<CollabEditor subject={editorSubject} />);
    await screen.findByRole('tab', { name: 'Markdown' });

    await userEvent.click(screen.getByRole('tab', { name: 'Markdown' }));

    expect(screen.getByTestId('collab-editor-container').hasAttribute('hidden')).toBe(false);
    expect(screen.queryByTestId('preview-editor')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Markdown' }).getAttribute('aria-selected')).toBe('true');
  });

  // WO-369/WO-387 (accessibility gate): CodeMirror gives `.cm-content` its own `role="textbox"
  // aria-multiline="true"` automatically, but no accessible name — `buildEditorExtensions`'s
  // `EditorView.contentAttributes` fix is what actually announces the region to a screen reader.
  it('gives the Markdown tab\'s CodeMirror content an accessible name', async () => {
    mockContext();
    render(<CollabEditor subject={editorSubject} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Markdown' }));

    expect(screen.getByRole('textbox', { name: 'Cuerpo del documento (Markdown)' })).toBeTruthy();
  });

  it('shows no banner for a normal, connected, editable document', () => {
    mockContext();
    render(<CollabEditor subject={editorSubject} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the "solo_lectura" banner when the server scoped this connection read-only', async () => {
    mockContext({ scope: 'readonly' });
    render(<CollabEditor subject={editorSubject} />);

    expect(await screen.findByText(/tu rol puede comentar pero no editar/)).toBeTruthy();
  });

  it('shows the "archivado" banner when the document is archived, even if the connection is read-write', async () => {
    mockContext();
    render(<CollabEditor subject={editorSubject} archived />);

    expect(await screen.findByText(/Sigue en el grafo, de solo lectura/)).toBeTruthy();
  });

  it('shows the "desconectado" alert banner, taking priority over archived/read-only', async () => {
    mockContext({ status: 'disconnected', scope: 'readonly' });
    render(<CollabEditor subject={editorSubject} archived />);

    expect(await screen.findByText(/Se cortó la conexión en tiempo real\./)).toBeTruthy();
    expect(screen.queryByText(/Sigue en el grafo/)).toBeNull();
  });
});
