/**
 * WO-635 (SDD-069): a commit sha is only useful if you can act on it — copy it exactly, or open the commit.
 * The link is bound to the project's own repository: without one there is no link at all (never a URL that
 * goes nowhere), but the copy keeps working.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShaRef } from '../../src/components/index.js';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const REPOSITORY = 'centurionhq/prdmanager';

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

describe('ShaRef (WO-635, SDD-069)', () => {
  it('shows the sha shortened to twelve characters, in mono type', () => {
    stubClipboard(() => Promise.resolve());
    render(<ShaRef sha={SHA} repository={REPOSITORY} />);

    const short = screen.getByText(SHA.slice(0, 12));
    expect(short.textContent).toHaveLength(12);
    expect(short.classList.contains('id')).toBe(true);
  });

  it('copies the full sha, never the shortened one shown on screen', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    render(<ShaRef sha={SHA} repository={REPOSITORY} />);

    await userEvent.click(screen.getByRole('button', { name: `Copiar el sha ${SHA}` }));

    expect(writeText).toHaveBeenCalledWith(SHA);
    expect(await screen.findByRole('button', { name: `Sha ${SHA} copiado` })).toBeTruthy();
  });

  it('links to the commit on GitHub when the project knows its repository', () => {
    stubClipboard(() => Promise.resolve());
    render(<ShaRef sha={SHA} repository={REPOSITORY} />);

    const link = screen.getByRole('link', { name: 'Ver el commit en GitHub' });
    expect(link.getAttribute('href')).toBe(`https://github.com/${REPOSITORY}/commit/${SHA}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders no commit link without a repository, and still offers the copy', () => {
    stubClipboard(() => Promise.resolve());
    render(<ShaRef sha={SHA} repository={null} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: `Copiar el sha ${SHA}` })).toBeTruthy();
  });

  it('treats an empty or blank repository as no repository', () => {
    stubClipboard(() => Promise.resolve());
    const { rerender } = render(<ShaRef sha={SHA} repository="" />);
    expect(screen.queryByRole('link')).toBeNull();

    rerender(<ShaRef sha={SHA} repository="   " />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says so when the browser refuses the clipboard, and keeps the link as the other way out', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    render(<ShaRef sha={SHA} repository={REPOSITORY} />);

    await userEvent.click(screen.getByRole('button', { name: `Copiar el sha ${SHA}` }));

    expect((await screen.findByRole('status')).textContent).toMatch(/a mano/);
    expect(screen.queryByRole('button', { name: `Sha ${SHA} copiado` })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ver el commit en GitHub' })).toBeTruthy();
  });

  it('survives a browser with no clipboard at all (an insecure context), without throwing', async () => {
    removeClipboard();
    render(<ShaRef sha={SHA} />);

    await userEvent.click(screen.getByRole('button', { name: `Copiar el sha ${SHA}` }));

    expect((await screen.findByRole('status')).textContent).toMatch(/a mano/);
  });

  it('goes back to offering a copy when the sha it shows changes', async () => {
    stubClipboard(() => Promise.resolve());
    const other = 'f'.repeat(40);
    const { rerender } = render(<ShaRef sha={SHA} />);
    await userEvent.click(screen.getByRole('button', { name: `Copiar el sha ${SHA}` }));
    expect(await screen.findByRole('button', { name: `Sha ${SHA} copiado` })).toBeTruthy();

    rerender(<ShaRef sha={other} />);

    expect(screen.getByRole('button', { name: `Copiar el sha ${other}` })).toBeTruthy();
  });
});
