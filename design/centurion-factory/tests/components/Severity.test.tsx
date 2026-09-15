import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Severity } from '../../src/components/Severity/Severity';

describe('Severity', () => {
  it('labels an error severity as "Error" by default', () => {
    render(<Severity severity="error" />);
    expect(screen.getByText('Error')).toBeTruthy();
  });

  it('labels a warning severity as "Aviso" by default', () => {
    render(<Severity severity="warning" />);
    expect(screen.getByText('Aviso')).toBeTruthy();
  });

  it('lets a caller override the label', () => {
    render(<Severity severity="error" label="Bloqueante" />);
    expect(screen.getByText('Bloqueante')).toBeTruthy();
  });

  it('renders a decorative mark hidden from assistive tech', () => {
    const { container } = render(<Severity severity="warning" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
