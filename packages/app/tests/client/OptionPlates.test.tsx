import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OptionPlates, type OptionPlate } from '../../src/components/index.js';

const OPTIONS: readonly OptionPlate[] = [
  { value: 'negocio', title: 'Traigo una necesidad del negocio', description: 'Escribí por qué conviene hacer algo.' },
  { value: 'producto', title: 'Defino qué se construye', description: 'Convertí una iniciativa aprobada en requisitos.' },
  { value: 'developer', title: 'Escribo el código', description: 'Conectá tu editor al proyecto.' },
];

describe('OptionPlates — radio mode (WO-545, SDD-051)', () => {
  it('is a radiogroup with one radio per option, each named by its title and carrying its description', () => {
    render(<OptionPlates label="Elegí la iniciativa" options={OPTIONS} value="producto" onChange={() => {}} />);

    expect(screen.getByRole('radiogroup', { name: 'Elegí la iniciativa' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    // The accessible name is the title plus the sentence under it: what a screen reader needs to choose.
    expect(screen.getByRole('radio', { name: /Defino qué se construye/ })).toBeTruthy();
    expect(screen.getByText('Convertí una iniciativa aprobada en requisitos.')).toBeTruthy();
  });

  it('marks exactly the selected option as checked', () => {
    render(<OptionPlates label="x" options={OPTIONS} value="producto" onChange={() => {}} />);

    expect(screen.getByRole('radio', { name: /Defino qué se construye/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /Escribo el código/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: /Traigo una necesidad/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('with nothing chosen yet, nothing is checked and the first plate is the one Tab lands on', () => {
    render(<OptionPlates label="x" options={OPTIONS} value={null} onChange={() => {}} />);

    for (const radio of screen.getAllByRole('radio')) expect(radio.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: /Traigo una necesidad/ }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('radio', { name: /Defino qué se construye/ }).getAttribute('tabindex')).toBe('-1');
  });

  it('once something is chosen, that plate is the only one in the tab order', () => {
    render(<OptionPlates label="x" options={OPTIONS} value="developer" onChange={() => {}} />);

    expect(screen.getByRole('radio', { name: /Escribo el código/ }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('radio', { name: /Traigo una necesidad/ }).getAttribute('tabindex')).toBe('-1');
  });

  it('a click reports the value of the plate that was clicked', async () => {
    const onChange = vi.fn();
    render(<OptionPlates label="x" options={OPTIONS} value={null} onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: /Defino qué se construye/ }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('producto');
  });

  it('the arrow keys move focus and the selection together, wrapping at both ends, like any radio', async () => {
    const onChange = vi.fn();
    render(<OptionPlates label="x" options={OPTIONS} value="negocio" onChange={onChange} />);

    screen.getByRole('radio', { name: /Traigo una necesidad/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('producto');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Defino qué se construye/ }));

    screen.getByRole('radio', { name: /Traigo una necesidad/ }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('developer');
  });

  it('draws a marker only when asked, so selection does not depend on colour alone', () => {
    const { container, rerender } = render(<OptionPlates label="x" options={OPTIONS} value="producto" onChange={() => {}} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);

    rerender(<OptionPlates label="x" options={OPTIONS} value="producto" onChange={() => {}} marker />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });
});

describe('OptionPlates — action mode (WO-545, SDD-051)', () => {
  it('is a plain group of buttons, not a radiogroup: nothing here is ever "checked"', () => {
    render(<OptionPlates label="¿Qué venís a hacer acá?" mode="action" options={OPTIONS} onChange={() => {}} />);

    expect(screen.getByRole('group', { name: '¿Qué venís a hacer acá?' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('aria-checked')).toBeNull();
  });

  it('a click commits right away with the clicked value', async () => {
    const onChange = vi.fn();
    render(<OptionPlates label="x" mode="action" options={OPTIONS} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /Escribo el código/ }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('developer');
  });

  it('Enter and Space commit, as on any button', async () => {
    const onChange = vi.fn();
    render(<OptionPlates label="x" mode="action" options={OPTIONS} onChange={onChange} />);

    screen.getByRole('button', { name: /Traigo una necesidad/ }).focus();
    await userEvent.keyboard('{Enter}');
    screen.getByRole('button', { name: /Defino qué se construye/ }).focus();
    await userEvent.keyboard(' ');

    expect(onChange.mock.calls).toEqual([['negocio'], ['producto']]);
  });

  it('the arrow keys do NOT commit: looking at an option must never save it', async () => {
    const onChange = vi.fn();
    render(<OptionPlates label="x" mode="action" options={OPTIONS} onChange={onChange} />);

    screen.getByRole('button', { name: /Traigo una necesidad/ }).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowDown}{ArrowLeft}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('every plate is reachable with Tab', async () => {
    render(<OptionPlates label="x" mode="action" options={OPTIONS} onChange={() => {}} />);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Traigo una necesidad/ }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Defino qué se construye/ }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Escribo el código/ }));
  });
});

describe('OptionPlates — meta line (SDD-052)', () => {
  const WITH_META: readonly OptionPlate[] = [
    { value: 'a', title: 'Mejorar la entrada', description: 'Se frena el arranque.', meta: <span data-testid="meta-a">BC-013 · 2 documentos</span> },
    { value: 'b', title: 'Un agente que se ve trabajar', description: 'El chat parece colgado.' },
  ];

  it('draws the meta of an option inside its own plate in radio mode, and counts it in the accessible name', () => {
    render(<OptionPlates label="Elegí la iniciativa" options={WITH_META} value="a" onChange={() => {}} />);

    const plate = screen.getByRole('radio', { name: /Mejorar la entrada/ });
    expect(plate.contains(screen.getByTestId('meta-a'))).toBe(true);
    expect(plate.textContent).toContain('BC-013');
  });

  it('draws it in action mode too, and a plate without meta stays as it was', () => {
    render(<OptionPlates label="x" mode="action" options={WITH_META} onChange={() => {}} />);

    expect(screen.getByRole('button', { name: /Mejorar la entrada/ }).contains(screen.getByTestId('meta-a'))).toBe(true);
    expect(screen.getAllByTestId(/meta-/)).toHaveLength(1);
  });
});
