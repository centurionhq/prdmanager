import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchField } from '../../src/components/SearchField/SearchField';

describe('SearchField', () => {
  it('exposes an accessible name from the label', () => {
    render(<SearchField label="Buscar órdenes" value="" onChange={vi.fn()} />);
    expect(screen.getByRole('searchbox', { name: 'Buscar órdenes' })).toBeTruthy();
  });

  it('shows the given placeholder', () => {
    render(<SearchField label="Buscar órdenes" value="" onChange={vi.fn()} placeholder="Buscar órdenes" />);
    expect(screen.getByPlaceholderText('Buscar órdenes')).toBeTruthy();
  });

  it('calls onChange as the user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchField label="Buscar órdenes" value="" onChange={onChange} />);
    await user.type(screen.getByRole('searchbox', { name: 'Buscar órdenes' }), 'drift');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toBe('drift'.at(-1));
  });

  it('shows a visible label when hideLabel is false', () => {
    render(<SearchField label="Buscar órdenes" value="" onChange={vi.fn()} hideLabel={false} />);
    const label = screen.getByText('Buscar órdenes');
    expect(label.className).not.toContain('visually-hidden');
  });

  it('does not render a clear button when the value is empty', () => {
    render(<SearchField label="Buscar órdenes" value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Borrar búsqueda' })).toBeNull();
  });

  it('renders a clear button that resets the value when there is text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchField label="Buscar órdenes" value="drift" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Borrar búsqueda' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
