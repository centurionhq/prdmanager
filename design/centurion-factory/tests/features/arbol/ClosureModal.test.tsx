import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components';
import * as data from '../../../src/data';
import { getFeature } from '../../../src/data';
import { ClosureModal } from '../../../src/features/arbol/ClosureModal';

function renderModal(featureId: string, onClosed = vi.fn(), onClose = vi.fn()) {
  const feature = getFeature(featureId);
  if (!feature) throw new Error(`${featureId} missing from mock data`);
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <ToastProvider>
          <ClosureModal feature={feature} open onClose={onClose} onClosed={onClosed} />
        </ToastProvider>
      ),
    },
    { path: '/drift', element: <p>drift</p> },
  ]);
  render(<RouterProvider router={router} />);
  return { onClosed, onClose };
}

describe('ClosureModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the pass summary and one row per check, with the technical name in mono', () => {
    renderModal('FR-001');
    expect(screen.getByText('Cuatro de cinco checks pasan')).toBeTruthy();
    expect(screen.getByText('La feature existe')).toBeTruthy();
    expect(screen.getByText('feature_exists')).toBeTruthy();
    expect(screen.getByText('El proyecto no tiene drift')).toBeTruthy();
  });

  it('shows the drift detail and a link to /drift for the failing project_clean check', () => {
    renderModal('FR-001');
    expect(screen.getByText(/Hay 3 errores de drift en el proyecto/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a Drift' }).getAttribute('href')).toBe('/drift');
  });

  it('disables "Cerrar feature" and shows the helper when not every check passes', () => {
    renderModal('FR-001');
    const button = screen.getByRole('button', { name: 'Cerrar feature' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Se habilita cuando pasan los cinco checks')).toBeTruthy();
  });

  it('clicking a disabled "Cerrar feature" does not close the feature', async () => {
    const user = userEvent.setup();
    const { onClosed } = renderModal('FR-001');
    await user.click(screen.getByRole('button', { name: 'Cerrar feature' }));
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('shows "Esta feature ya está cerrada." and no primary action for an already-closed feature', () => {
    renderModal('PRD-002');
    expect(screen.getByText('Esta feature ya está cerrada.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cerrar feature' })).toBeNull();
  });

  it('enables "Cerrar feature" once every check passes, and closing it toasts and calls onClosed', async () => {
    // project_clean is the only check FR-001 fails, and it reads a fixed project-wide drift count
    // (no drift-acknowledgement flow exists yet in this package). Stub it clean to exercise the
    // fully-enabled path without inventing a feature that does not exist in the mock graph.
    vi.spyOn(data, 'getProject').mockReturnValue({
      slug: 'prdmanager',
      name: 'prdmanager',
      documentCount: 292,
      archived: false,
      furthestStation: 'cierre',
      driftErrors: 0,
      driftWarnings: 0,
      awaitingFirstReport: false,
      workOrdersInProgress: 0,
      role: 'admin',
      lastActivity: '2026-09-15T09:56:00.000Z',
    });

    const user = userEvent.setup();
    const { onClosed, onClose } = renderModal('FR-001');
    expect(screen.getByText('Cinco de cinco checks pasan')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Cerrar feature' });
    expect(button.hasAttribute('disabled')).toBe(false);

    await user.click(button);
    expect(onClosed).toHaveBeenCalledWith('FR-001');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('status')).textContent).toContain('Feature cerrada');
  });
});
