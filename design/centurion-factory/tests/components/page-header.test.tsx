import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '../../src/components';

describe('PageHeader', () => {
  it('renders the screen title as the only h1 with subtitle and actions', () => {
    render(<PageHeader title="Drift" subtitle="Reporte oficial de main" actions={<button type="button">Reconocer drift</button>} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Drift' })).toBeTruthy();
    expect(screen.getByText('Reporte oficial de main')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reconocer drift' })).toBeTruthy();
  });
});
