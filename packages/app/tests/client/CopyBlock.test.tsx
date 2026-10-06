/**
 * WO-567 (SDD-055/PRD-033 R4): the copyable block. What matters is that what is shown is exactly what is
 * copied, and that a browser refusing the clipboard never leaves someone believing they copied something.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyBlock } from '../../src/components/index.js';

const COMMANDS = 'prdm login --server https://centurion.example\nprdm link acme/web --server https://centurion.example --mcp';

function stubClipboard(impl: () => Promise<void>): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

function removeClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  removeClipboard();
});

describe('CopyBlock (WO-567, SDD-055)', () => {
  it('shows the text verbatim, newlines and all, inside a group named by its label', () => {
    stubClipboard(() => Promise.resolve());
    render(<CopyBlock label="Comandos para vincular" text={COMMANDS} />);

    const group = screen.getByRole('group', { name: 'Comandos para vincular' });
    expect(group.textContent).toContain('prdm login --server https://centurion.example');
    expect(group.textContent).toContain('prdm link acme/web --server https://centurion.example --mcp');
  });

  it('copies exactly what it shows, and says it did', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    render(<CopyBlock label="Comandos" text={COMMANDS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(writeText).toHaveBeenCalledWith(COMMANDS);
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeTruthy();
  });

  it('when the browser refuses the clipboard it says so, and never claims it copied', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    render(<CopyBlock label="Comandos" text={COMMANDS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/a mano/);
    expect(screen.queryByRole('button', { name: 'Copiado' })).toBeNull();
    // The text is still there to select by hand, which is the whole fallback.
    expect(screen.getByRole('group', { name: 'Comandos' }).textContent).toContain('prdm login');
  });

  it('survives a browser with no clipboard at all (an insecure context), without throwing', async () => {
    removeClipboard();
    render(<CopyBlock label="Comandos" text={COMMANDS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/a mano/);
  });

  it('goes back to offering a copy when the text it shows changes', async () => {
    stubClipboard(() => Promise.resolve());
    const { rerender } = render(<CopyBlock label="Comandos" text={COMMANDS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeTruthy();

    rerender(<CopyBlock label="Comandos" text="prdm hooks install" />);

    expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy();
  });

  it('a second copy of the same text still reaches the clipboard', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    render(<CopyBlock label="Comandos" text={COMMANDS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copiado' }));

    expect(writeText).toHaveBeenCalledTimes(2);
  });
});
