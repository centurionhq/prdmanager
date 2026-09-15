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

  it('changing a block to Título 2 updates the model and the Markdown source', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstOf(screen.getAllByDisplayValue(/El paquete design\/centurion-factory/)) as HTMLInputElement;
    await user.click(field);
    await user.click(firstButton('Título 2'));

    expect(firstButton('Título 2').getAttribute('aria-pressed')).toBe('true');

    await switchToMarkdown(user);
    const markdown = firstOf(screen.getAllByLabelText('Fuente en Markdown del documento')) as HTMLTextAreaElement;
    expect(markdown.value).toContain('## El paquete design/centurion-factory');
  });

  it('Negrita on a selection wraps it in ** inside the block model', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/SDD-011');
    await screen.findByText(/Versión 7/);

    const field = firstOf(screen.getAllByDisplayValue(/El paquete design\/centurion-factory/)) as HTMLInputElement;
    await user.click(field);
    const start = field.value.indexOf('solo con datos mock');
    field.setSelectionRange(start, start + 'solo con datos mock'.length);

    await user.click(firstButton('Negrita'));

    expect(field.value).toContain('**solo con datos mock**');
  });

  it('editing the Markdown tab and switching back updates the preview', async () => {
    const user = userEvent.setup();
    renderAt('/documentos/MRD-001');
    await screen.findByText(/Versión 3/);

    await switchToMarkdown(user);
    const markdown = firstOf(screen.getAllByLabelText('Fuente en Markdown del documento')) as HTMLTextAreaElement;
    await user.type(markdown, '\n\nUna línea nueva desde Markdown.');

    await switchToPreview(user);
    expect(firstOf(screen.getAllByDisplayValue('Una línea nueva desde Markdown.'))).toBeTruthy();
  });
});
