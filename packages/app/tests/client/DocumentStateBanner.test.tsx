import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentStateBanner } from '../../src/components/DocumentStateBanner/DocumentStateBanner.js';

describe('DocumentStateBanner', () => {
  it('renders the "generado" copy as a status, not an alert', () => {
    render(<DocumentStateBanner variant="generado" />);
    expect(screen.getByRole('status').textContent).toMatch(/lo escribió el motor/);
  });

  it('renders the "archivado" copy', () => {
    render(<DocumentStateBanner variant="archivado" />);
    expect(screen.getByRole('status').textContent).toMatch(/Sigue en el grafo, de solo lectura/);
  });

  it('renders the "solo_lectura" copy', () => {
    render(<DocumentStateBanner variant="solo_lectura" />);
    expect(screen.getByRole('status').textContent).toMatch(/tu rol puede comentar pero no editar/);
  });

  it('renders the "desconectado" copy as an alert, since it is actually urgent', () => {
    render(<DocumentStateBanner variant="desconectado" />);
    expect(screen.getByRole('alert').textContent).toMatch(/Se cortó la conexión en tiempo real/);
  });
});
