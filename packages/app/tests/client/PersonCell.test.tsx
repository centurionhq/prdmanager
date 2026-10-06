import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PersonCell } from '../../src/routes/miembros/PersonCell.js';

describe('PersonCell (WO-581, SDD-056)', () => {
  it('shows the name and the email as text', () => {
    render(<PersonCell name="Ana Ríos" email="ana@example.test" />);

    expect(screen.getByText('Ana Ríos')).toBeTruthy();
    expect(screen.getByText('ana@example.test')).toBeTruthy();
  });

  it('marks the row that is the person looking at the screen', () => {
    render(<PersonCell name="Ana Ríos" email="ana@example.test" you />);

    expect(screen.getByText('Vos')).toBeTruthy();
  });

  it('does not say "Vos" for anyone else', () => {
    render(<PersonCell name="Julia Paz" email="julia@example.test" />);

    expect(screen.queryByText('Vos')).toBeNull();
  });

  it('draws initials as decoration only, never as something read aloud', () => {
    const { container } = render(<PersonCell name="Ana Ríos" email="ana@example.test" />);

    const avatar = container.querySelector('[aria-hidden="true"]');
    expect(avatar?.textContent).toBe('AR');
  });

  it('falls back to the email initial for someone with no name', () => {
    const { container } = render(<PersonCell name="" email="zoe@example.test" />);

    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('Z');
  });
});
