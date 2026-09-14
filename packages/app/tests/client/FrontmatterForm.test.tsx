/**
 * WO-160 — the form reads/writes a real local `Y.Doc`'s `fm` map directly (no HocuspocusProvider/network
 * needed): `useCollabDocumentContext` is mocked to return a lightweight fake `{provider, state}` whose
 * `provider.document` is a genuine `Y.Doc`, so every Yjs interaction this test exercises is real.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontmatterForm } from '../../src/components/FrontmatterForm.js';
import * as collabContext from '../../src/collab/collab-document-context.js';

function renderWithLocalDoc(ydoc: Y.Doc, scope: 'read-write' | 'readonly' = 'read-write') {
  const provider = { document: ydoc, awareness: null };
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: provider as never,
    state: { status: 'connected', synced: true, scope, presence: [] },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'PRD-001',
    editorView: null,
    setEditorView: () => {},
  });
}

describe('FrontmatterForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the fields for the given kind and reflects the Y.Map\'s current values', () => {
    const ydoc = new Y.Doc({ gc: false });
    ydoc.getMap('fm').set('title', 'Existing title');
    ydoc.getMap('fm').set('tags', ['alpha', 'beta']);
    renderWithLocalDoc(ydoc);

    render(<FrontmatterForm kind="PRD" />);

    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Existing title');
    expect((screen.getByLabelText('Etiquetas') as HTMLInputElement).value).toBe('alpha, beta');
    expect((screen.getByLabelText('Implementa') as HTMLInputElement).value).toBe('');
  });

  it('typing into a text field writes directly to the Y.Map, no save button', async () => {
    const ydoc = new Y.Doc({ gc: false });
    renderWithLocalDoc(ydoc);
    render(<FrontmatterForm kind="PRD" />);

    await userEvent.type(screen.getByLabelText('Título'), 'New title');

    expect(ydoc.getMap('fm').get('title')).toBe('New title');
  });

  it('a comma-separated id-list field commits an array to the Y.Map on blur', async () => {
    const ydoc = new Y.Doc({ gc: false });
    renderWithLocalDoc(ydoc);
    render(<FrontmatterForm kind="PRD" />);

    await userEvent.type(screen.getByLabelText('Implementa'), 'SDD-001, SDD-002');
    await userEvent.tab(); // blur — commits the draft text to the Y.Map

    expect(ydoc.getMap('fm').get('implements')).toEqual(['SDD-001', 'SDD-002']);
  });

  it('a boolean field (root) writes true/false to the Y.Map', async () => {
    const ydoc = new Y.Doc({ gc: false });
    renderWithLocalDoc(ydoc);
    render(<FrontmatterForm kind="ART" />);

    await userEvent.click(screen.getByLabelText('Raíz (excepción de ciclo de vida)'));

    expect(ydoc.getMap('fm').get('root')).toBe(true);
  });

  it('shows a validation error for an invalid field without blocking the write', async () => {
    const ydoc = new Y.Doc({ gc: false });
    ydoc.getMap('fm').set('title', 'A valid title'); // isolates the assertion to the "implements" issue
    renderWithLocalDoc(ydoc);
    render(<FrontmatterForm kind="PRD" />);

    await userEvent.type(screen.getByLabelText('Implementa'), 'not-an-id');
    await userEvent.tab();

    const implementsField = screen.getByLabelText('Implementa').closest('div');
    expect(implementsField?.querySelector('[role="alert"]')?.textContent).toMatch(/invalid document id/i);
    expect(ydoc.getMap('fm').get('implements')).toEqual(['not-an-id']);
  });

  it('is read-only when the connection scope is readonly: fields are disabled and never write', async () => {
    const ydoc = new Y.Doc({ gc: false });
    renderWithLocalDoc(ydoc, 'readonly');
    render(<FrontmatterForm kind="PRD" />);

    expect((screen.getByLabelText('Título') as HTMLInputElement).disabled).toBe(true);
  });

  it('a document edited by a second local Y.Doc (e.g. another peer, merged in) updates the form via fm.observe', () => {
    const ydoc = new Y.Doc({ gc: false });
    renderWithLocalDoc(ydoc);
    render(<FrontmatterForm kind="PRD" />);

    const peer = new Y.Doc({ gc: false });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));
    peer.getMap('fm').set('title', 'Set by a peer');
    // `act()`: the resulting `fm.observe` callback calls `setValues` outside of any React-managed event
    // handler, so React (18+ automatic batching) needs the explicit act() boundary to flush it
    // synchronously before the assertion below reads the DOM.
    act(() => {
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer));
    });

    expect((screen.getByLabelText('Título') as HTMLInputElement).value).toBe('Set by a peer');
  });

  it('renders nothing for a kind with no frontmatter fields (WO)', () => {
    const ydoc = new Y.Doc({ gc: false });
    renderWithLocalDoc(ydoc);
    const { container } = render(<FrontmatterForm kind="WO" />);
    expect(container.innerHTML).toBe('');
  });
});
