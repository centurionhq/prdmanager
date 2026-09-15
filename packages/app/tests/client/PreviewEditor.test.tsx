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

    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeTruthy();
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
    expect(screen.getByRole('heading', { level: 1, name: 'Original' })).toBeTruthy();

    act(() => {
      const doc = ytext.doc!;
      doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, '# Updated');
      }, 'remote-collaborator');
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Updated' })).toBeTruthy();
    expect(screen.queryByText('Original')).toBeNull();
  });
});
