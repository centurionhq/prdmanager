import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';
import { mockMatchMedia, restoreMatchMedia } from './matchMedia';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(restoreMatchMedia);

// DocumentoPage renders a single layout (WO-311); helpers still take the first match for
// symmetry with tests that render either layout.
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

  it('clicking Negrita on already-bold text unwraps it instead of nesting a second <strong>', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    selectTextWithin(field, 'solo con datos mock');
    await user.click(firstButton('Negrita'));
    expect(field.querySelector('strong')).toBeTruthy();
    expect(firstButton('Negrita').getAttribute('aria-pressed')).toBe('true');

    await user.click(firstButton('Negrita'));

    expect(field.querySelector('strong')).toBeNull();
    expect(field.textContent).toContain('solo con datos mock');
    expect(firstButton('Negrita').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Editor: Enlace popover keyboard and focus behavior', () => {
  it('disables Enlace until a block has real focus', async () => {
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    expect(firstButton('Enlace').hasAttribute('disabled')).toBe(true);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    act(() => field.focus());

    expect(firstButton('Enlace').hasAttribute('disabled')).toBe(false);
  });

  it('Escape closes the popover, returns focus to the block and restores the selection', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    selectTextWithin(field, 'solo con datos mock');

    await user.click(firstButton('Enlace'));
    const urlInput = firstOf(screen.getAllByLabelText('URL del enlace'));
    expect(urlInput).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByLabelText('URL del enlace')).toBeNull();
    expect(document.activeElement).toBe(field);
    const selection = window.getSelection();
    expect(selection?.toString()).toBe('solo con datos mock');
  });
});

describe('Editor: link href sanitizing', () => {
  it('inserting a javascript: URL through the Enlace popover never sets it as the href', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstFieldContaining('El paquete design/centurion-factory');
    field.focus();
    selectTextWithin(field, 'solo con datos mock');

    await user.click(firstButton('Enlace'));
    const urlInput = firstOf(screen.getAllByLabelText('URL del enlace'));
    await user.type(urlInput, 'javascript:alert(1)');
    await user.click(firstButton('Insertar'));

    const anchor = field.querySelector('a');
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('href')).toBe('#');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(field.innerHTML).not.toContain('javascript:');
  });
});

describe('Toolbar on mobile: block style is a native select, not a button group', () => {
  it('shows a "Estilo de bloque" select instead of the Párrafo/Título button group', async () => {
    const user = userEvent.setup();
    mockMatchMedia(true);
    renderAt('/documentos/SDD-011');
    await screen.findByRole('tablist', { name: 'Secciones del documento' });

    const field = firstFieldContaining('El paquete design/centurion-factory');
    act(() => field.focus());

    const select = screen.getByRole('combobox', { name: 'Estilo de bloque' }) as HTMLSelectElement;
    expect(select.value).toBe('p');
    expect(screen.queryByRole('button', { name: 'Título 2' })).toBeNull();

    await user.selectOptions(select, 'h2');

    await user.click(firstTab('Markdown'));
    expect(firstMarkdownTextarea().value).toContain('## El paquete design/centurion-factory');
  });

  it('still shows Negrita/Cursiva/Tachado as icon buttons', async () => {
    mockMatchMedia(true);
    renderAt('/documentos/SDD-011');
    await screen.findByRole('tablist', { name: 'Secciones del documento' });

    expect(screen.getByRole('button', { name: 'Negrita' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cursiva' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tachado' })).toBeTruthy();
  });
});
