/**
 * WO-379: `Toolbar.tsx` wired to `edit-ops.ts`'s pure functions — every button computes a `Splice` from
 * whatever `source`/`activeBlock`/`selectionRange` it's given and hands it to `onApplySplice`, never
 * touching the DOM or `Y.Text` itself (that's `PreviewEditor.tsx`'s job, WO-383).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../../src/editor/Toolbar.js';
import { classifyDocument, type SourceBlock } from '../../src/editor/source-map.js';
import type { Splice } from '../../src/editor/edit-ops.js';

function blockOf(source: string, index = 0): SourceBlock {
  const block = classifyDocument(source)[index];
  if (!block) throw new Error('expected a block');
  return block;
}

describe('Toolbar (WO-379)', () => {
  it('Negrita applies the toggleMark splice for the current selection', async () => {
    const user = userEvent.setup();
    const source = 'hello world';
    const onApplySplice = vi.fn();
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 6, to: 11 }} onApplySplice={onApplySplice} />);

    await user.click(screen.getByRole('button', { name: 'Negrita' }));

    expect(onApplySplice).toHaveBeenCalledWith({ from: 6, to: 11, insert: '**world**' } satisfies Splice);
  });

  it('Cursiva applies the toggleMark splice for emphasis', async () => {
    const user = userEvent.setup();
    const source = 'hello world';
    const onApplySplice = vi.fn();
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 0, to: 5 }} onApplySplice={onApplySplice} />);

    await user.click(screen.getByRole('button', { name: 'Cursiva' }));

    expect(onApplySplice).toHaveBeenCalledWith({ from: 0, to: 5, insert: '*hello*' } satisfies Splice);
  });

  it('Tachado applies the toggleMark splice for strikethrough', async () => {
    const user = userEvent.setup();
    const source = 'hello world';
    const onApplySplice = vi.fn();
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 0, to: 5 }} onApplySplice={onApplySplice} />);

    await user.click(screen.getByRole('button', { name: 'Tachado' }));

    expect(onApplySplice).toHaveBeenCalledWith({ from: 0, to: 5, insert: '~~hello~~' } satisfies Splice);
  });

  it('marks are disabled when the selection is collapsed', () => {
    const source = 'hello world';
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 3, to: 3 }} onApplySplice={vi.fn()} />);

    expect((screen.getByRole('button', { name: 'Negrita' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a block-style button applies the setBlockType splice', async () => {
    const user = userEvent.setup();
    const source = 'hello world';
    const onApplySplice = vi.fn();
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 3, to: 3 }} onApplySplice={onApplySplice} />);

    await user.click(screen.getByRole('button', { name: 'Título 1' }));

    expect(onApplySplice).toHaveBeenCalledWith({ from: 0, to: 0, insert: '# ' } satisfies Splice);
  });

  it('block-style buttons are disabled on the protected "## Tareas" heading', () => {
    const source = '## Tareas';
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 0, to: 0 }} onApplySplice={vi.fn()} />);

    for (const name of ['Párrafo', 'Título 1', 'Título 2', 'Título 3']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('block-style buttons reflect the active block kind via aria-pressed', () => {
    const source = '# Title';
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 0, to: 0 }} onApplySplice={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Título 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Párrafo' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Tarea toggles the checkbox of the active task-item block via toggleTask', async () => {
    const user = userEvent.setup();
    const source = '- [ ] todo';
    const onApplySplice = vi.fn();
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 0, to: 0 }} onApplySplice={onApplySplice} />);

    await user.click(screen.getByRole('button', { name: 'Tarea' }));

    expect(onApplySplice).toHaveBeenCalledWith({ from: 3, to: 4, insert: 'x' } satisfies Splice);
  });

  it('Tarea is disabled when the active block is not a task-item', () => {
    const source = 'hello world';
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 0, to: 0 }} onApplySplice={vi.fn()} />);

    expect((screen.getByRole('button', { name: 'Tarea' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Enlace opens a popover that applies the insertLink splice on submit', async () => {
    const user = userEvent.setup();
    const source = 'hello world';
    const onApplySplice = vi.fn();
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 0, to: 5 }} onApplySplice={onApplySplice} />);

    await user.click(screen.getByRole('button', { name: 'Enlace' }));
    await user.type(screen.getByLabelText('URL del enlace'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Insertar' }));

    expect(onApplySplice).toHaveBeenCalledWith({ from: 0, to: 5, insert: '[hello](https://example.com)' } satisfies Splice);
  });

  it('Enlace is disabled without a non-collapsed selection', () => {
    const source = 'hello world';
    render(<Toolbar source={source} activeBlock={blockOf(source)} selectionRange={{ from: 3, to: 3 }} onApplySplice={vi.fn()} />);

    expect((screen.getByRole('button', { name: 'Enlace' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('every button is disabled when there is no active block', () => {
    render(<Toolbar source="" activeBlock={null} selectionRange={null} onApplySplice={vi.fn()} />);

    for (const name of ['Negrita', 'Cursiva', 'Tachado', 'Enlace', 'Tarea', 'Párrafo', 'Título 1']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
