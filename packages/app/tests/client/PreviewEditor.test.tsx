/**
 * WO-376 — render-only coverage: block/inline classification (`classifyDocument`) mapped to real DOM
 * nodes, islands rendered read-only and distinguishable, and automatic re-render when `Y.Text` changes
 * from outside the component (simulating another collaborator or the Markdown tab).
 */
import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import { PreviewEditor } from '../../src/editor/PreviewEditor.js';

function docWithBody(body: string): Y.Text {
  const ydoc = new Y.Doc({ gc: false });
  const ytext = ydoc.getText('body');
  ytext.insert(0, body);
  return ytext;
}

describe('PreviewEditor (WO-376)', () => {
  it('renders headings, a paragraph with inline marks, and grouped list items with correct tags', () => {
    const ytext = docWithBody(
      ['# Title', '', 'A **bold** and *em* paragraph.', '', '- one', '- two', '', '1. first', '2. second', '', '- [ ] todo', '- [x] done'].join('\n'),
    );

    render(<PreviewEditor ytext={ytext} />);

    // WO-387 (accessibility gate): a body `# heading` renders as `<h2>`, never `<h1>` — the page's own
    // `<h1>` is always `DocumentDetail.tsx`'s document title, rendered outside this component entirely.
    expect(screen.getByRole('heading', { level: 2, name: 'Title' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('em').tagName).toBe('EM');

    const bulletItems = screen.getAllByText(/^(one|two)$/);
    expect(bulletItems).toHaveLength(2);
    expect(bulletItems[0]!.closest('ul')).toBeTruthy();

    const orderedItems = screen.getAllByText(/^(first|second)$/);
    expect(orderedItems[0]!.closest('ol')).toBeTruthy();

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]!.checked).toBe(false);
    expect(checkboxes[1]!.checked).toBe(true);
    // WO-387 (accessibility gate): the label tracks checked state, never a static "completed" claim for
    // a still-pending task (contradicting the checkbox's own native checked/unchecked announcement).
    expect(screen.getByRole('checkbox', { name: 'Tarea pendiente' })).toBe(checkboxes[0]);
    expect(screen.getByRole('checkbox', { name: 'Tarea completada' })).toBe(checkboxes[1]);
  });

  it('renders an island distinguishably and read-only, with an "Editar en Markdown" callback', () => {
    const source = ['A paragraph.', '', '```js', 'const x = 1;', '```'].join('\n');
    const ytext = docWithBody(source);
    const onEditInMarkdown = vi.fn();

    render(<PreviewEditor ytext={ytext} onEditInMarkdown={onEditInMarkdown} />);

    const island = screen.getByTestId('island');
    expect(island.textContent).toContain('const x = 1;');

    screen.getByRole('button', { name: /editar en markdown/i }).click();
    expect(onEditInMarkdown).toHaveBeenCalledWith(source.indexOf('```js'));
  });

  it('re-renders automatically when the Y.Text changes from outside (another collaborator)', () => {
    const ytext = docWithBody('# Original');
    render(<PreviewEditor ytext={ytext} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Original' })).toBeTruthy();

    act(() => {
      const doc = ytext.doc!;
      doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, '# Updated');
      }, 'remote-collaborator');
    });

    expect(screen.getByRole('heading', { level: 2, name: 'Updated' })).toBeTruthy();
    expect(screen.queryByText('Original')).toBeNull();
  });

  it('exposes the editable surface as a labeled, multiline textbox to assistive technology (WO-387)', () => {
    const ytext = docWithBody('A paragraph.');
    render(<PreviewEditor ytext={ytext} />);

    const editable = screen.getByRole('textbox', { name: 'Cuerpo del documento' });
    expect(editable).toBe(screen.getByTestId('preview-editor'));
    expect(editable.getAttribute('aria-multiline')).toBe('true');
    expect(editable.getAttribute('contenteditable')).toBe('true');
  });

  it('marks the read-only surface as non-editable while keeping the same accessible name (WO-387)', () => {
    const ytext = docWithBody('A paragraph.');
    render(<PreviewEditor ytext={ytext} readOnly />);

    const editable = screen.getByRole('textbox', { name: 'Cuerpo del documento' });
    expect(editable.getAttribute('aria-readonly')).toBe('true');
    expect(editable.getAttribute('contenteditable')).toBe('false');
  });
});
