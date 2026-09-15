import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { getFeature } from '../../../src/data';
import { TraceabilityPanel } from '../../../src/features/arbol/TraceabilityPanel';

function renderPanel(featureId: string, onOpenClosure?: () => void) {
  const feature = getFeature(featureId);
  if (!feature) throw new Error(`${featureId} missing from mock data`);
  const router = createMemoryRouter([
    { path: '/', element: <TraceabilityPanel feature={feature} onOpenClosure={onOpenClosure} /> },
    { path: '/documentos/:id', element: <p>documento</p> },
    { path: '/ordenes', element: <p>ordenes</p> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

describe('TraceabilityPanel', () => {
  it('renders the feature id, status badge, title and parent/closed meta line', () => {
    renderPanel('PRD-004');
    expect(screen.getByRole('heading', { level: 2, name: 'Explorador web del Feature Tree y del drift' })).toBeTruthy();
    expect(screen.getByText('Cerrada')).toBeTruthy();
    expect(screen.getByText(/Hija de PRD-002/)).toBeTruthy();
    expect(screen.getByText(/Cerrada el/)).toBeTruthy();
  });

  it('omits the meta line for the root feature, which has no parent or closedAt', () => {
    renderPanel('MRD-001');
    expect(screen.queryByText(/Hija de/)).toBeNull();
  });

  it('renders the six-column trazabilidad chain with the canvas numbers for PRD-004', () => {
    renderPanel('PRD-004');
    expect(screen.getByText('Origen')).toBeTruthy();
    expect(screen.getByText('FB-004')).toBeTruthy();
    expect(screen.getByText('Blueprints')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ADR-004' }).getAttribute('href')).toBe('/documentos/ADR-004');
    expect(screen.getByRole('link', { name: '37 hechas' }).getAttribute('href')).toBe('/ordenes?feature=PRD-004');
    expect(screen.getByText('41 con Refs')).toBeTruthy();
    expect(screen.getByText('212 referencias sincronizadas')).toBeTruthy();
  });

  it('shows the out-of-sync code count when a feature has code drift', () => {
    renderPanel('FR-002');
    expect(screen.getByText('2 fuera de sincronía')).toBeTruthy();
  });

  it('renders the recent work orders table for the primary blueprint', () => {
    renderPanel('PRD-004');
    expect(screen.getByRole('heading', { level: 3, name: /Órdenes recientes de/ })).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('WO-069')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver las 37 órdenes' }).getAttribute('href')).toBe('/ordenes?blueprint=SDD-005');
  });

  it('calls onOpenClosure when "Ver cierre de feature" is clicked', async () => {
    const user = userEvent.setup();
    const onOpenClosure = vi.fn();
    renderPanel('PRD-004', onOpenClosure);
    await user.click(screen.getByRole('button', { name: 'Ver cierre de feature' }));
    expect(onOpenClosure).toHaveBeenCalledTimes(1);
  });

  it('does not render a recent orders table for a feature with no blueprints', () => {
    renderPanel('FR-003');
    expect(screen.queryByRole('table')).toBeNull();
  });
});
