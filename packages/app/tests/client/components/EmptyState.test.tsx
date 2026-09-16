import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../../../src/components/EmptyState/EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="Ninguna orden coincide con estos filtros." />);
    expect(screen.getByText('Ninguna orden coincide con estos filtros.')).toBeTruthy();
  });

  it('renders the optional body copy', () => {
    render(<EmptyState title="Sin resultados" body="Probá con otros filtros." />);
    expect(screen.getByText('Probá con otros filtros.')).toBeTruthy();
  });

  it('omits the body when none is given', () => {
    render(<EmptyState title="Sin resultados" />);
    expect(screen.queryByText('Probá con otros filtros.')).toBeNull();
  });

  it('renders an action button and calls onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<EmptyState title="Sin resultados" action={{ label: 'Quitar filtros', onClick }} />);
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('omits the action when none is given', () => {
    render(<EmptyState title="Sin resultados" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
