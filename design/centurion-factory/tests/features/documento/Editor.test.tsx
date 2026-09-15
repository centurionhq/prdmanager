import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

// The editor mounts once in the desktop layout and once inside the mobile "Documento" tab.
function firstOf<T extends HTMLElement>(elements: T[]): T {
  return elements[0] as T;
}

function firstTab(name: string): HTMLElement {
  return firstOf(screen.getAllByRole('tab', { name }));
}

function firstButton(name: RegExp | string): HTMLElement {
  return firstOf(screen.getAllByRole('button', { name }));
}

/** The first contentEditable preview field whose rendered text contains `text`. */
function firstFieldContaining(text: string): HTMLElement {
  const field = screen
    .getAllByRole('textbox')
    .find((element) => element.textContent?.includes(text) && element.getAttribute('contenteditable') === 'true');
  if (!field) throw new Error(`No contentEditable field contains: ${text}`);
  return field;
}

function firstMarkdownTextarea(): HTMLTextAreaElement {
  return firstOf(screen.getAllByLabelText('Fuente en Markdown del documento')) as HTMLTextAreaElement;
}

/** Selects the first occurrence of `needle` inside `container`'s text, like a user drag-select. */
function selectTextWithin(container: HTMLElement, needle: string): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = (node.textContent ?? '').indexOf(needle);
    if (index === -1) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + needle.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return;
  }
  throw new Error(`Text not found in container: ${needle}`);
}

async function switchToMarkdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(firstTab('Markdown'));
}

async function switchToPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(firstTab('Vista previa'));
}

describe('Editor: preview/Markdown tabs', () => {
  it('opens in Vista previa by default', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const previewTab = firstTab('Vista previa');
    expect(previewTab.getAttribute('aria-selected')).toBe('true');
    expect(firstTab('Markdown').getAttribute('aria-selected')).toBe('false');
    expect(firstOf(screen.getAllByText(/Vista previa · \d+ bloques/))).toBeTruthy();
  });

  it('changing the focused block to Título 2 updates the model and the Markdown source', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    await user.click(firstButton('Título 2'));

    expect(firstButton('Título 2').getAttribute('aria-pressed')).toBe('true');

    await switchToMarkdown(user);
    expect(firstMarkdownTextarea().value).toContain('## El paquete design/centurion-factory');
  });
});

describe('Editor: WYSIWYG inline formatting', () => {
  it('Negrita on a selection renders <strong>, never literal **, and serializes to ** in Markdown', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    selectTextWithin(field, 'solo con datos mock');

    await user.click(firstButton('Negrita'));

    expect(field.querySelector('strong')?.textContent).toBe('solo con datos mock');
    expect(field.textContent).not.toContain('**');
    expect(firstButton('Negrita').getAttribute('aria-pressed')).toBe('true');

    await switchToMarkdown(user);
    expect(firstMarkdownTextarea().value).toContain('**solo con datos mock**');
  });

  it('editing the Markdown tab and switching back renders real formatting, not literal markup', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/MRD-001');
    await screen.findByText(/Versión 3/);

    await switchToMarkdown(user);
    const markdown = firstMarkdownTextarea();
    await user.type(markdown, '\n\nUna línea con **negrita** desde Markdown.');

    await switchToPreview(user);

    const field = firstFieldContaining('Una línea con negrita desde Markdown.');
    expect(field.querySelector('strong')?.textContent).toBe('negrita');
    expect(field.textContent).not.toContain('**');
  });
});
