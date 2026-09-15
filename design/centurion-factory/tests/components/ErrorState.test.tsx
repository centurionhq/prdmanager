import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from '../../src/components/ErrorState/ErrorState';

describe('ErrorState', () => {
  it('renders as an alert with the title and body', () => {
    render(
      <ErrorState
        title="No pudimos leer el reporte de CI"
        body="Reintentá o revisá el token."
        onRetry={() => {}}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No pudimos leer el reporte de CI');
    expect(alert.textContent).toContain('Reintentá o revisá el token.');
  });

  it('defaults the retry button label to "Reintentar"', () => {
    render(<ErrorState title="Error" body="Detalle" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('lets a caller override the retry label', () => {
    render(<ErrorState title="Error" body="Detalle" onRetry={() => {}} retryLabel="Probar de nuevo" />);
    expect(screen.getByRole('button', { name: 'Probar de nuevo' })).toBeTruthy();
  });

  it('calls onRetry when the retry button is clicked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState title="Error" body="Detalle" onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
