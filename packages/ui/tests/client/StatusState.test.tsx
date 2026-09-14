import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/StatusState';

describe('StatusState', () => {
  it('LoadingState announces the given label politely', () => {
    render(<LoadingState label="Cargando árbol…" />);
    expect(screen.getByRole('status').textContent).toContain('Cargando árbol…');
  });

  it('ErrorState surfaces the error message and calls onRetry when clicked', async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new Error('network down')} onRetry={onRetry} />);

    expect(screen.getByRole('alert').textContent).toContain('network down');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState has no retry button when onRetry is omitted', () => {
    render(<ErrorState error={new Error('boom')} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('EmptyState renders the given label', () => {
    render(<EmptyState label="Sin work orders para este filtro" />);
    expect(screen.queryByText('Sin work orders para este filtro')).not.toBeNull();
  });
});
