import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '../../src/components/Skeleton/Skeleton';

describe('Skeleton', () => {
  it('marks its container as busy', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('true');
  });

  it('announces the loading state to assistive tech', () => {
    render(<Skeleton />);
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('renders 3 rows by default', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(3);
  });

  it('renders the requested number of rows', () => {
    const { container } = render(<Skeleton rows={5} />);
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(5);
  });

  it('renders the requested number of columns per row', () => {
    const { container } = render(<Skeleton rows={2} columns={4} />);
    const rows = container.querySelectorAll('[data-skeleton-row]');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelectorAll('[data-skeleton-bar]')).toHaveLength(4);
    }
  });
});
