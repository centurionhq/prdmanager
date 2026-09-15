import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function firstOf<T extends HTMLElement>(elements: T[]): T {
  return elements[0] as T;
}

function firstTab(name: string): HTMLElement {
  return firstOf(screen.getAllByRole('tab', { name }));
}

// DocumentoPage currently mounts an EditorColumn for both the desktop and the mobile layout
// (WO-311 fixes that duplication); scope every query to the first one so block counts are exact.
function firstEditorContainer(): HTMLElement {
  const tablist = firstOf(screen.getAllByRole('tablist', { name: 'Modo del editor' }));
  return tablist.parentElement as HTMLElement;
}

function firstFieldContaining(text: string): HTMLElement {
  const field = within(firstEditorContainer())
    .getAllByRole('textbox')
    .find((element) => element.textContent?.includes(text) && element.getAttribute('contenteditable') === 'true');
  if (!field) throw new Error(`No contentEditable field contains: ${text}`);
  return field;
}

function firstMarkdownTextarea(): HTMLTextAreaElement {
  return within(firstEditorContainer()).getByLabelText('Fuente en Markdown del documento') as HTMLTextAreaElement;
}

function contentEditableFields(): HTMLElement[] {
  return within(firstEditorContainer())
    .getAllByRole('textbox')
    .filter((element) => element.getAttribute('contenteditable') === 'true');
}

/** Collapses the caret right after the first occurrence of `needle` inside `container`'s text. */
function placeCaretAfter(container: HTMLElement, needle: string): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = (node.textContent ?? '').indexOf(needle);
    if (index === -1) continue;
    const range = document.createRange();
    range.setStart(node, index + needle.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return;
  }
  throw new Error(`Text not found in container: ${needle}`);
}

/** Collapses the caret at the very start of `container`. */
function placeCaretAtStart(container: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

async function switchToMarkdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(firstTab('Markdown'));
}

describe('Editor: Enter splits a block at the caret', () => {
  it('splits a paragraph into two p blocks, focusing the new one at its start', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    placeCaretAfter(field, 'El paquete design/centurion-factory');
    const before = contentEditableFields().length;

    fireEvent.keyDown(field, { key: 'Enter' });

    expect(contentEditableFields().length).toBe(before + 1);
    expect(firstFieldContaining('El paquete design/centurion-factory').textContent).toBe('El paquete design/centurion-factory');
    const after = firstFieldContaining('aísla el rediseño');
    expect(after.textContent?.trimStart()).toBe(' aísla el rediseño de packages/app y trabaja solo con datos mock.'.trimStart());
    expect(document.activeElement).toBe(after);

    await switchToMarkdown(user);
    const lines = firstMarkdownTextarea().value.split('\n');
    expect(lines).toContain('El paquete design/centurion-factory');
  });

  it('splits a heading into the heading and a new p block below it', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('Contexto');
    field.focus();
    placeCaretAfter(field, 'Contexto');
    fireEvent.keyDown(field, { key: 'Enter' });

    const heading = firstFieldContaining('Contexto');
    expect(heading.getAttribute('aria-label')).toContain('Título 2');
    const newField = contentEditableFields().find((element) => element !== heading && element.textContent === '');
    expect(newField).toBeTruthy();
    expect(newField?.getAttribute('aria-label')).toContain('Párrafo');
  });

  it('splits a list item into two items of the same type', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('Archivo para todo el texto');
    field.focus();
    placeCaretAfter(field, 'Archivo para todo el texto; IBM Plex Mono solo para ids, SHAs y rutas.');
    const before = contentEditableFields().length;
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(contentEditableFields().length).toBe(before + 1);
    const newField = contentEditableFields().find((element) => element.textContent === '' && element.getAttribute('aria-label')?.includes('lista'));
    expect(newField).toBeTruthy();
  });
});

describe('Editor: Backspace at the start of a block merges it into the previous one', () => {
  it('removes an empty block created by Enter and returns focus to the previous field', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    placeCaretAfter(field, 'El paquete design/centurion-factory aísla el rediseño de packages/app y trabaja solo con datos mock.');
    const before = contentEditableFields().length;
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(contentEditableFields().length).toBe(before + 1);

    const emptyField = contentEditableFields().find((element) => element.textContent === '');
    expect(emptyField).toBeTruthy();
    placeCaretAtStart(emptyField as HTMLElement);
    fireEvent.keyDown(emptyField as HTMLElement, { key: 'Backspace' });

    expect(contentEditableFields().length).toBe(before);
    expect(document.activeElement).toBe(firstFieldContaining('El paquete design/centurion-factory'));
  });

  it('merges a non-empty block into the previous one, keeping both texts', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('Tokens en tokens.css');
    field.focus();
    placeCaretAtStart(field);
    const before = contentEditableFields().length;
    fireEvent.keyDown(field, { key: 'Backspace' });

    expect(contentEditableFields().length).toBe(before - 1);
    expect(firstFieldContaining('Archivo para todo el texto').textContent).toContain('Tokens en tokens.css');
  });
});

describe('Editor: pasting plain text', () => {
  it('inserts a single-line paste at the caret instead of the browser default', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    placeCaretAfter(field, 'El paquete design/centurion-factory');

    fireEvent.paste(field, { clipboardData: { getData: () => ' pegado' } });

    expect(field.textContent).toContain('El paquete design/centurion-factory pegado');
  });

  it('splits a multi-line paste into additional blocks', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    placeCaretAfter(field, 'El paquete design/centurion-factory');
    const before = contentEditableFields().length;

    fireEvent.paste(field, { clipboardData: { getData: () => 'Línea uno\nLínea dos\nLínea tres' } });

    expect(contentEditableFields().length).toBe(before + 2);
    expect(firstFieldContaining('El paquete design/centurion-factory').textContent).toContain('Línea uno');
    expect(firstFieldContaining('Línea dos')).toBeTruthy();
    expect(firstFieldContaining('Línea tres')).toBeTruthy();
  });
});
