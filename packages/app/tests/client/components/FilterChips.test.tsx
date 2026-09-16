import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FilterChips } from '../../../src/components/FilterChips/FilterChips';

const options = [
  { value: 'all', label: 'Todas', count: 40 },
  { value: 'pending', label: 'Pendientes', count: 26 },
  { value: 'done', label: 'Hechas', count: 2 },
];

describe('FilterChips', () => {
  it('renders a radiogroup labeled by the given label', () => {
    render(<FilterChips label="Filtrar por estado" options={options} value="all" onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Filtrar por estado' })).toBeTruthy();
  });

  it('renders every option as a radio with its label and count', () => {
    render(<FilterChips label="Filtrar por estado" options={options} value="all" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Todas/ }).textContent).toContain('40');
    expect(screen.getByRole('radio', { name: /Pendientes/ })).toBeTruthy();
  });

  it('marks the current value as checked', () => {
    render(<FilterChips label="Filtrar por estado" options={options} value="pending" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Pendientes/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /Todas/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('calls onChange when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterChips label="Filtrar por estado" options={options} value="all" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: /Pendientes/ }));
    expect(onChange).toHaveBeenCalledWith('pending');
  });

  it('moves to the next option with ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterChips label="Filtrar por estado" options={options} value="all" onChange={onChange} />);
    screen.getByRole('radio', { name: /Todas/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('pending');
  });

  it('wraps to the first option with ArrowRight from the last one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterChips label="Filtrar por estado" options={options} value="done" onChange={onChange} />);
    screen.getByRole('radio', { name: /Hechas/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('moves to the previous option with ArrowLeft', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterChips label="Filtrar por estado" options={options} value="pending" onChange={onChange} />);
    screen.getByRole('radio', { name: /Pendientes/ }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('only the selected chip is tab-reachable', () => {
    render(<FilterChips label="Filtrar por estado" options={options} value="pending" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Pendientes/ }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('radio', { name: /Todas/ }).getAttribute('tabindex')).toBe('-1');
  });

  it('already grows each chip to a 44px hit target below the mobile breakpoint', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../../src/components/FilterChips/FilterChips.module.css'), 'utf8');
    expect(css).toMatch(/@media[^{]*\{[^}]*\.chip\s*\{[^}]*height:\s*var\(--hit-target\)/);
  });
});
